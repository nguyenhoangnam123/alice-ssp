// POST /api/chat/message — sends a chat turn to Bedrock via the metered
// invoke. Pre-flight budget check is the SAME function the orchestrator
// uses; over-budget returns HTTP 402 + a structured payload that the
// chat UI surfaces to the user.
//
// Auth: requires the ssp_chat_id_token cookie set by /api/chat/login.
// Cost attribution: pinned to the ssp-portal tenant (the chat service
// belongs to the platform tenant for MVP1; a real tenant-owned chat
// would derive the tenant from the JWT custom:tenant_id claim).
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { services, tenants } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  meteredBedrockInvoke,
  checkBudget,
  emitGuardedAction,
} from "@/lib/observability";

const bodySchema = z.object({
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        text: z.string().min(1),
      }),
    )
    .min(1)
    .max(50),
  user_sub: z.string().min(1),
});

// We resolve the chat service once and cache the result — service.id +
// tenant.id are what get persisted into llm_calls so dashboards aggregate.
let cachedCtx:
  | { tenantId: string; crId: string; serviceName: string }
  | null = null;

async function resolveChatCtx() {
  if (cachedCtx) return cachedCtx;
  const [svc] = await db
    .select({ id: services.id, name: services.name, tenantId: services.tenantId })
    .from(services)
    .innerJoin(tenants, eq(tenants.id, services.tenantId))
    .where(and(eq(services.name, "chat"), eq(tenants.domain, "alice")))
    .limit(1);
  if (!svc) throw new Error("chat service not seeded");
  // We reuse the service id as a stable trace ID for all chat messages, so
  // any one user's session traces hang off a single tree filter. A real
  // production design would use a per-session ID.
  cachedCtx = {
    tenantId: svc.tenantId,
    crId: `svc:${svc.id}`,
    serviceName: svc.name,
  };
  return cachedCtx;
}

function parseJwt(jwt: string): Record<string, unknown> | null {
  try {
    const [, payload] = jwt.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString());
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const c = await cookies();
  const idToken = c.get("ssp_chat_id_token")?.value;
  if (!idToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const claims = parseJwt(idToken);
  if (!claims) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

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

  const ctx = await resolveChatCtx();

  // ----- The cost guardrail. Same checkBudget() the orchestrator uses. -----
  const budget = await checkBudget(ctx.tenantId);
  if (!budget.ok) {
    emitGuardedAction({
      tenantId: ctx.tenantId,
      actorUserId: (claims.sub as string) ?? body.user_sub,
      action: "chat.budget_exceeded",
      resource: `service:${ctx.serviceName}`,
      outcome: "blocked",
      detail: `chat refused: spent $${budget.spentUsd.toFixed(4)} of $${budget.capUsd.toFixed(2)}`,
    });
    return NextResponse.json(
      {
        error: "budget_exceeded",
        spent_usd: budget.spentUsd,
        cap_usd: budget.capUsd,
      },
      { status: 402 },
    );
  }

  // Build the Anthropic-style messages array. Drop role=system; we'll prefix
  // a tiny system prompt below.
  const anthMessages = body.history
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      content: [{ type: "text", text: m.text }],
    }));

  const model = "eu.anthropic.claude-haiku-4-5-v1";
  const reqBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text:
          "You are SSP Chat, the Alice self-service portal's bundled chat. " +
          "Be concise. If asked who you are, say you're the platform's demo chat " +
          "running on Claude Haiku 4.5 through Bedrock, metered by the SSP cost guardrail.",
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: anthMessages,
  };

  try {
    const result = await meteredBedrockInvoke({
      traceId: ctx.crId,
      tenantId: ctx.tenantId,
      crId: ctx.crId,
      modelId: model,
      body: reqBody,
    });
    return NextResponse.json({
      reply: result.rawText,
      cost_usd: result.costUsd,
      latency_ms: result.latencyMs,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "bedrock_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
