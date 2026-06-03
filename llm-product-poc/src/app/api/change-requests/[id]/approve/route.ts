// POST /api/change-requests/[id]/approve
//
// Approves a SECRET change-request. Reads the staged value from the pending
// SM path, applies it to the main bundle (upsert merges into the JSON
// bundle; delete drops the key), then transitions the CR to applied.
//
// Auth: requireTenantAdmin on the CR's tenant. A future improvement is to
// require a SEPARATE admin from the submitter (4-eyes), but for MVP one
// admin role covers it. Non-secret CRs (kind != "secret") are rejected with
// 400 — those go through the GitHub PR merge path, not this endpoint.

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  changeRequests,
  services,
  serviceRevisions,
} from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { applyPending, dropPending } from "@/lib/secrets/manager";
import { emitGuardedAction } from "@/lib/observability";
import { handleApiError } from "@/lib/api/errors";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id: crId } = await ctx.params;
    const user = await requireUser();

    const [cr] = await db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.id, crId))
      .limit(1);
    if (!cr) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const [svc] = await db
      .select()
      .from(services)
      .where(eq(services.id, cr.serviceId))
      .limit(1);
    if (!svc) {
      return NextResponse.json({ error: "service_not_found" }, { status: 404 });
    }
    await requireTenantAdmin(svc.tenantId);

    const payload = (cr.payload ?? {}) as Record<string, unknown>;
    if (payload.kind !== "secret") {
      return NextResponse.json(
        {
          error: "wrong_kind",
          detail: "this endpoint approves secret CRs only; non-secret CRs are applied via the PR-merge webhook",
        },
        { status: 400 },
      );
    }
    if (cr.status !== "platform_reviewing") {
      return NextResponse.json(
        {
          error: "not_pending",
          detail: `CR is in status '${cr.status}'; only 'platform_reviewing' can be approved`,
        },
        { status: 409 },
      );
    }

    const result = await applyPending({
      tenantId: svc.tenantId,
      serviceId: svc.id,
      crId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "apply_failed", detail: result.reason },
        { status: 500 },
      );
    }

    // Append-only audit on the CR row.
    const event = {
      status: "applied" as const,
      at: new Date().toISOString(),
      detail: `approved by ${user.id}; ${result.action} ${result.key}${result.masked ? " → " + result.masked : ""}`,
    };
    await db
      .update(changeRequests)
      .set({
        status: "applied",
        updatedAt: new Date(),
        statusHistory: sql`coalesce(${changeRequests.statusHistory}, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb`,
      })
      .where(eq(changeRequests.id, crId));

    // Mirror the revision row so the timeline reflects the approval.
    await db
      .update(serviceRevisions)
      .set({ crStatus: "applied", serviceStatus: "working" })
      .where(eq(serviceRevisions.changeRequestId, crId));

    emitGuardedAction({
      tenantId: svc.tenantId,
      actorUserId: user.id,
      action: "secret.approved",
      resource: `change_request:${crId}/secret:${result.key}`,
      outcome: "allowed",
      detail: `admin approved CR ${crId}: ${result.action} ${result.key}`,
    });

    return NextResponse.json({ ok: true, action: result.action, key: result.key });
  } catch (err) {
    return handleApiError(err);
  }
}
