// Emit observability events as one JSON line on stderr in CloudWatch Embedded
// Metric Format. CW picks up stdout AND stderr from the container identically,
// and EMF lets a single JSON-line event produce both logs AND dimensional
// metrics with no extra agent.
//
// Schema is shared with mcp-server/src/server.ts. The portal speaks the MCP
// contract directly (library mode) rather than spawning the MCP server as a
// child process — vibe-coded apps that consume our platform use the
// stdio-server in mcp-server/; the portal owns its own process so the IPC
// overhead would be silly.

import { ulid } from "ulid";
import { db } from "@/lib/db";
import { guardedActions } from "@/lib/db/schema";

export type SpanStatus = "ok" | "error";
export type GuardedActionOutcome = "allowed" | "blocked" | "warning";

export type LiveSpan = {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  name: string;
  startedAtMs: number;
  attributes: Record<string, string | number | boolean>;
};

function nowJsonLine(record: Record<string, unknown>) {
  // One JSON line on stderr — the SSP_OBSERVABILITY env can disable this for
  // local dev when stderr noise is unwanted.
  if (process.env.SSP_OBSERVABILITY_DISABLED === "true") return;
  try {
    process.stderr.write(JSON.stringify(record) + "\n");
  } catch (err) {
    // Should never happen but never throw from an observability path.
    // Fall back to console.error so we at least see it somewhere.
    console.error("observability emit failed", err);
  }
}

export function emitSpan(span: LiveSpan, status: SpanStatus, extra?: Record<string, unknown>) {
  const durationMs = Date.now() - span.startedAtMs;
  nowJsonLine({
    _aws: {
      CloudWatchMetrics: [
        {
          Namespace: "SSP/Spans",
          Dimensions: [["service", "span_name"]],
          Metrics: [{ Name: "SpanDurationMs", Unit: "Milliseconds" }],
        },
      ],
      Timestamp: Date.now(),
    },
    service: "ssp",
    event: "span",
    trace_id: span.traceId,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId,
    span_name: span.name,
    duration_ms: durationMs,
    SpanDurationMs: durationMs,
    status,
    attributes: { ...span.attributes, ...(extra ?? {}) },
  });
}

export function emitLlmCall(args: {
  tenantId: string;
  crId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd: number;
  latencyMs?: number;
}) {
  nowJsonLine({
    _aws: {
      CloudWatchMetrics: [
        {
          Namespace: "SSP/Bedrock",
          Dimensions: [
            ["tenant_id", "model"],
            ["model"],
          ],
          Metrics: [
            { Name: "TokensInput", Unit: "Count" },
            { Name: "TokensOutput", Unit: "Count" },
            { Name: "CostUSD", Unit: "None" },
            ...(args.latencyMs !== undefined
              ? [{ Name: "LatencyMs", Unit: "Milliseconds" }]
              : []),
          ],
        },
      ],
      Timestamp: Date.now(),
    },
    service: "ssp",
    event: "llm_call",
    tenant_id: args.tenantId,
    cr_id: args.crId,
    model: args.model,
    TokensInput: args.inputTokens,
    TokensOutput: args.outputTokens,
    cache_read_tokens: args.cacheReadTokens ?? 0,
    cache_write_tokens: args.cacheWriteTokens ?? 0,
    CostUSD: args.costUsd,
    LatencyMs: args.latencyMs,
  });
}

export function emitGuardedAction(args: {
  tenantId: string;
  actorUserId: string;
  action: string;
  resource?: string;
  outcome: GuardedActionOutcome;
  detail?: string;
}) {
  // EMF on stderr — CW Logs is the authoritative store.
  nowJsonLine({
    service: "ssp",
    event: "guarded_action",
    tenant_id: args.tenantId,
    actor_user_id: args.actorUserId,
    action: args.action,
    resource: args.resource,
    outcome: args.outcome,
    detail: args.detail,
    ts: new Date().toISOString(),
  });
  // Also persist for in-portal queries (MCP audit logs tab). Fire-and-forget
  // — a DB hiccup must not break the calling code path (policy gate, budget
  // guard, etc.). CW EMF emit above is the durable record.
  void db
    .insert(guardedActions)
    .values({
      id: ulid(),
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      action: args.action,
      resource: args.resource,
      outcome: args.outcome,
      detail: args.detail,
    })
    .catch((err) =>
      console.warn("guarded_actions insert failed (non-fatal)", err),
    );
}
