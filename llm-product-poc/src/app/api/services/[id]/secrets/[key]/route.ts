// DELETE /api/services/[id]/secrets/[key]
//
// Creates a SECRET delete change-request. Approval drops the key from the
// main bundle. Same review path as upsert — admins must approve from the
// CR detail page.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { services, changeRequests } from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import {
  writePending,
  validateKey,
  SecretValidationError,
} from "@/lib/secrets/manager";
import { processChangeRequest } from "@/lib/workflow/orchestrator";
import { emitGuardedAction } from "@/lib/observability";
import { handleApiError } from "@/lib/api/errors";

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; key: string }> },
) {
  try {
    const { id, key } = await ctx.params;
    const user = await requireUser();
    const [svc] = await db
      .select()
      .from(services)
      .where(eq(services.id, id))
      .limit(1);
    if (!svc) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await requireTenantAdmin(svc.tenantId);

    try {
      validateKey(key);
    } catch (err) {
      if (err instanceof SecretValidationError) {
        return NextResponse.json(
          { error: "validation_failed", detail: err.message },
          { status: 400 },
        );
      }
      throw err;
    }

    const crId = ulid();
    await db.insert(changeRequests).values({
      id: crId,
      serviceId: svc.id,
      requestedBy: user.id,
      summary: `Delete secret ${key} on ${svc.name}`,
      payload: { kind: "secret", action: "delete", key },
      status: "submitted",
    });

    try {
      await writePending({
        tenantId: svc.tenantId,
        serviceId: svc.id,
        crId,
        payload: { action: "delete", key },
      });
    } catch (err) {
      await db.delete(changeRequests).where(eq(changeRequests.id, crId));
      throw err;
    }

    emitGuardedAction({
      tenantId: svc.tenantId,
      actorUserId: user.id,
      action: "secret.cr_submitted",
      resource: `service:${svc.id}/secret:${key}`,
      outcome: "allowed",
      detail: `secret-delete CR ${crId} submitted for key ${key}`,
    });

    processChangeRequest(crId).catch((err) =>
      console.error("orchestrator failed on secret CR", err),
    );

    return NextResponse.json(
      { id: crId, change_request_id: crId },
      { status: 202 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
