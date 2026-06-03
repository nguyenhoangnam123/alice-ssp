// The cost-and-tracing guardrail for Bedrock invocations.
//
// Two responsibilities:
//   1. checkBudget — pre-flight: sum the tenant's month-to-date Bedrock spend
//      from llm_calls. If at or over cap, REFUSE. The orchestrator turns this
//      into an ai_validation_rejected CR with a budget-specific reason.
//   2. meteredBedrockInvoke — wraps BedrockRuntimeClient.send with: span open,
//      invoke, parse usage, compute cost, insert llm_calls row, emit MCP
//      event, span close. Idempotent on the DB write — re-running with the
//      same generated id is impossible because we ulid-it per call.
//
// The MCP server in ../../../../mcp-server/ defines the schema for these
// events; the portal speaks the same schema in-process (no IPC) because it
// owns the trace IDs.

import { ulid } from "ulid";
import { sql, eq, and, gte } from "drizzle-orm";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { db } from "@/lib/db";
import { llmCalls, tenants } from "@/lib/db/schema";
import { computeCostUSD } from "./pricing";
import { emitLlmCall, emitGuardedAction } from "./emit";
import { withSpan } from "./tracing";

export class BudgetExceededError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly spentUsd: number,
    public readonly capUsd: number,
  ) {
    super(
      `tenant ${tenantId} is over its Bedrock monthly cap: spent $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}`,
    );
  }
}

export type BudgetCheck =
  | { ok: true; spentUsd: number; capUsd: number; remainingUsd: number }
  | { ok: false; spentUsd: number; capUsd: number };

/**
 * Returns whether the tenant has Bedrock budget left this calendar month.
 * Does NOT reserve / debit — the actual debit happens when meteredBedrockInvoke
 * inserts the llm_calls row after a successful call. Treat the check as
 * "best-effort guardrail, not a transactional reservation." A concurrent
 * burst of CRs from the same tenant can each pass the check and then push the
 * tenant over cap; the alarm catches this in <1 minute, and Ring 3's per-call
 * rate limit closes the window. For MVP1 this is acceptable.
 */
export async function checkBudget(tenantId: string): Promise<BudgetCheck> {
  const [tenant] = await db
    .select({ cap: tenants.bedrockMonthlyCapUsd })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) {
    // Treat unknown tenant as over budget — refuse the call, force the
    // operator to look at why.
    return { ok: false, spentUsd: 0, capUsd: 0 };
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ spent }] = await db
    .select({
      spent: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)`,
    })
    .from(llmCalls)
    .where(
      and(
        eq(llmCalls.tenantId, tenantId),
        gte(llmCalls.createdAt, monthStart),
      ),
    );

  const spentUsd = Number(spent);
  const capUsd = Number(tenant.cap);
  if (spentUsd >= capUsd) {
    return { ok: false, spentUsd, capUsd };
  }
  return { ok: true, spentUsd, capUsd, remainingUsd: capUsd - spentUsd };
}

// Lazy singleton so we don't construct a Bedrock client at module load (matters
// for tests + local dev without AWS creds).
let cachedClient: BedrockRuntimeClient | null = null;
function bedrockClient(): BedrockRuntimeClient {
  if (!cachedClient) {
    cachedClient = new BedrockRuntimeClient({
      region: process.env.BEDROCK_REGION ?? "eu-west-1",
    });
  }
  return cachedClient;
}

export type MeteredBedrockResult = {
  rawText: string;
  costUsd: number;
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
};

/**
 * Invoke Bedrock with a span open around the call, then persist a llm_calls
 * row and emit the MCP-shaped event. Caller is expected to have already
 * called checkBudget; we do NOT recheck inside this function because the
 * orchestrator wants to differentiate a budget-block (a guarded action) from
 * a Bedrock failure (a different error class).
 *
 * `actorUserId` and `crId` propagate into the audit + trace; both should be
 * present when called from the orchestrator.
 */
export async function meteredBedrockInvoke(args: {
  traceId: string;
  parentSpanId?: string;
  tenantId: string;
  /**
   * CR ID to persist on the llm_calls row. Pass ONLY when this call is part of
   * processing a real ChangeRequest — otherwise the FK to change_requests will
   * fail and the row silently drops. Use the traceId field for synthetic IDs
   * (chat sessions, batch jobs).
   */
  crId?: string;
  modelId: string;
  body: Record<string, unknown>;
}): Promise<MeteredBedrockResult> {
  return withSpan(
    {
      traceId: args.traceId,
      parentSpanId: args.parentSpanId,
      name: "orch.ai_invoke.bedrock_call",
      attributes: { tenant_id: args.tenantId, model: args.modelId },
    },
    async (_spanId) => {
      const start = Date.now();
      const res = await bedrockClient().send(
        new InvokeModelCommand({
          modelId: args.modelId,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify(args.body),
        }),
      );
      const latencyMs = Date.now() - start;

      const decoded = new TextDecoder().decode(res.body);
      const parsed = JSON.parse(decoded) as {
        content: Array<{ type: string; text?: string }>;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };

      const rawText = parsed.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");

      const usage = {
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        cacheReadTokens: parsed.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: parsed.usage?.cache_creation_input_tokens ?? 0,
      };

      const costUsd = computeCostUSD(args.modelId, usage);

      if (Number.isNaN(costUsd)) {
        // Model not in pricing table — means the orchestrator's model
        // allowlist drifted. Record the call with cost=0 but flag it via a
        // guarded action so the security/cost team sees it.
        emitGuardedAction({
          tenantId: args.tenantId,
          actorUserId: "system",
          action: "bedrock.unknown_model",
          resource: `change_request:${args.crId}`,
          outcome: "warning",
          detail: `model ${args.modelId} not in pricing table; call succeeded but cost is unknown`,
        });
      }

      const recordedCost = Number.isNaN(costUsd) ? 0 : costUsd;

      // Persist for budget queries + audit. Failure here is non-fatal — we
      // want the orchestrator to keep moving the CR forward even if our cost
      // bookkeeping has a hiccup.
      try {
        await db.insert(llmCalls).values({
          id: ulid(),
          // Only set the FK when the caller has a real CR — synthetic trace IDs
          // (chat sessions like 'svc:<svc-id>') would FK-violate.
          changeRequestId: args.crId ?? null,
          tenantId: args.tenantId,
          modelId: args.modelId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          costUsd: recordedCost.toFixed(6),
          latencyMs,
        });
      } catch (err) {
        // We log instead of throw so a metering hiccup doesn't break the user's
        // chat reply. Pre-fix this masked an FK violation; the warning level
        // tells a future reader to look here.
        console.warn("llm_calls insert failed (non-fatal)", err);
      }

      // Emit the MCP-shaped EMF event regardless of DB outcome — CloudWatch is
      // a separate authority on this metric.
      emitLlmCall({
        tenantId: args.tenantId,
        crId: args.crId,
        model: args.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        costUsd: recordedCost,
        latencyMs,
      });

      // Keep the legacy single-line log too — humans tailing kubectl logs
      // still find it readable.
      console.log(
        `bedrock ok model=${args.modelId} ms=${latencyMs} tok_in=${usage.inputTokens} tok_out=${usage.outputTokens} cache_read=${usage.cacheReadTokens} cost_usd=${recordedCost.toFixed(6)}`,
      );

      return { rawText, costUsd: recordedCost, latencyMs, usage };
    },
  );
}
