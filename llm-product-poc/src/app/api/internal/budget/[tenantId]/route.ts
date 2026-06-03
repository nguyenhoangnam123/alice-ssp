// GET /api/internal/budget/[tenantId]
//
// The tenant-side cost guardrail. The MCP server running inside a tenant pod
// calls this BEFORE invoking Bedrock, and refuses to proceed if {ok: false}.
//
// Same checkBudget() as the orchestrator uses — single source of truth for
// "is this tenant at or over their monthly cap." We don't reserve / debit
// here; recording happens in /api/internal/llm-calls after the call completes.
import { NextRequest, NextResponse } from "next/server";
import { checkBudget } from "@/lib/observability";
import { checkInternalAuth } from "@/lib/api/internal-auth";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tenantId: string }> },
) {
  const authFail = checkInternalAuth(req);
  if (authFail) return authFail;

  const { tenantId } = await ctx.params;
  const result = await checkBudget(tenantId);
  return NextResponse.json({
    tenant_id: tenantId,
    ok: result.ok,
    spent_usd: result.spentUsd,
    cap_usd: result.capUsd,
    remaining_usd:
      result.ok && "remainingUsd" in result ? result.remainingUsd : 0,
  });
}
