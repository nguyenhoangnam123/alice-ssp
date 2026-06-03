// DELETE /api/services/[id]/secrets/[key]
//
// Idempotent — deleting an absent key returns 204 same as deleting a present
// one. If the last key in the bundle is removed, the entire AWS Secrets
// Manager secret is dropped (so rebuild on re-add isn't held up by the 7-day
// recovery window).

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { deleteKey, SecretValidationError } from "@/lib/secrets/manager";
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
      await deleteKey({
        tenantId: svc.tenantId,
        serviceId: svc.id,
        key,
      });
    } catch (err) {
      if (err instanceof SecretValidationError) {
        return NextResponse.json(
          { error: "validation_failed", detail: err.message },
          { status: 400 },
        );
      }
      throw err;
    }

    emitGuardedAction({
      tenantId: svc.tenantId,
      actorUserId: user.id,
      action: "secret.delete",
      resource: `service:${svc.id}/secret:${key}`,
      outcome: "allowed",
      detail: `key ${key} deleted on service ${svc.name}`,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handleApiError(err);
  }
}
