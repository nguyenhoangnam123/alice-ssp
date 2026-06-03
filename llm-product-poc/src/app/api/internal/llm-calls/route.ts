// POST /api/internal/llm-calls
//
// Tenant pods (via their MCP sidecar) record each Bedrock invocation here so
// the portal's budget math has fresh data. We don't trust the client-provided
// cost — we recompute via the pricing table. If the tenant claims a model
// that isn't on the allowlist, we 400 (and the audit log captures the attempt).
import { NextRequest, NextResponse } from "next/server";
import { ulid } from "ulid";
import { z } from "zod";
import { db } from "@/lib/db";
import { llmCalls, tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  computeCostUSD,
  emitLlmCall,
  emitGuardedAction,
} from "@/lib/observability";
import { checkInternalAuth } from "@/lib/api/internal-auth";

const bodySchema = z.object({
  tenant_id: z.string().min(1),
  change_request_id: z.string().min(1).optional(),
  model: z.string().min(1),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative().default(0),
  cache_write_tokens: z.number().int().nonnegative().default(0),
  latency_ms: z.number().nonnegative().optional(),
  actor_user_id: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authFail = checkInternalAuth(req);
  if (authFail) return authFail;

  let body;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "validation_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  // Confirm the tenant exists. We don't validate that the caller "is" this
  // tenant — that's the JWT story in Ring 2. For now we trust the shared
  // token and the tenant_id in the body.
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.id, body.tenant_id))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "unknown_tenant" }, { status: 404 });
  }

  // Recompute cost from the allowlisted pricing table — never trust the
  // client. Unknown model → 400 + guarded_action so the security team sees
  // an allowlist-drift attempt.
  const costUsd = computeCostUSD(body.model, {
    inputTokens: body.input_tokens,
    outputTokens: body.output_tokens,
    cacheReadTokens: body.cache_read_tokens,
    cacheWriteTokens: body.cache_write_tokens,
  });
  if (Number.isNaN(costUsd)) {
    emitGuardedAction({
      tenantId: body.tenant_id,
      actorUserId: body.actor_user_id ?? "tenant-app",
      action: "bedrock.unknown_model",
      resource: body.change_request_id
        ? `change_request:${body.change_request_id}`
        : `tenant:${body.tenant_id}`,
      outcome: "blocked",
      detail: `tenant app reported a model not in pricing table: ${body.model}`,
    });
    return NextResponse.json(
      { error: "model_not_in_allowlist", model: body.model },
      { status: 400 },
    );
  }

  const id = ulid();
  await db.insert(llmCalls).values({
    id,
    changeRequestId: body.change_request_id,
    tenantId: body.tenant_id,
    modelId: body.model,
    inputTokens: body.input_tokens,
    outputTokens: body.output_tokens,
    cacheReadTokens: body.cache_read_tokens,
    cacheWriteTokens: body.cache_write_tokens,
    costUsd: costUsd.toFixed(6),
    latencyMs:
      body.latency_ms !== undefined ? Math.round(body.latency_ms) : null,
  });

  emitLlmCall({
    tenantId: body.tenant_id,
    crId: body.change_request_id,
    model: body.model,
    inputTokens: body.input_tokens,
    outputTokens: body.output_tokens,
    cacheReadTokens: body.cache_read_tokens,
    cacheWriteTokens: body.cache_write_tokens,
    costUsd,
    latencyMs: body.latency_ms,
  });

  return NextResponse.json({ id, cost_usd: costUsd });
}
