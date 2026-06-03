// POST /api/change-requests/[id]/reject
//
// Rejects a SECRET change-request. Drops the staged value from the pending
// SM path and transitions the CR to rejected. Non-secret CRs go through the
// PR-close GitHub path, not this endpoint.

import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  changeRequests,
  services,
  serviceRevisions,
} from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { dropPending } from "@/lib/secrets/manager";
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
        { error: "wrong_kind", detail: "endpoint rejects secret CRs only" },
        { status: 400 },
      );
    }
    if (cr.status !== "platform_reviewing") {
      return NextResponse.json(
        { error: "not_pending", detail: `CR is in status '${cr.status}'` },
        { status: 409 },
      );
    }

    await dropPending(svc.tenantId, svc.id, crId);

    const event = {
      status: "rejected" as const,
      at: new Date().toISOString(),
      detail: `rejected by ${user.id}; staged value dropped`,
    };
    await db
      .update(changeRequests)
      .set({
        status: "rejected",
        updatedAt: new Date(),
        statusHistory: sql`coalesce(${changeRequests.statusHistory}, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb`,
      })
      .where(eq(changeRequests.id, crId));

    await db
      .update(serviceRevisions)
      .set({
        crStatus: "rejected",
        serviceStatus: "rejected",
        existenceStatus: "rejected",
      })
      .where(eq(serviceRevisions.changeRequestId, crId));

    emitGuardedAction({
      tenantId: svc.tenantId,
      actorUserId: user.id,
      action: "secret.rejected",
      resource: `change_request:${crId}/secret:${payload.key}`,
      outcome: "blocked",
      detail: `admin rejected CR ${crId}: ${payload.action} ${payload.key}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
