// GET   /api/services/[id]/secrets        — list keys (NEVER values)
// POST  /api/services/[id]/secrets        — upsert one key/value pair
//
// Auth: requireTenantAdmin against the service's tenant. Same surface the
// rest of /dashboard/services/* uses, so the secrets UI inherits the existing
// access control without a separate model.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import {
  listKeys,
  upsertKey,
  SecretValidationError,
} from "@/lib/secrets/manager";
import { emitGuardedAction } from "@/lib/observability";
import { handleApiError } from "@/lib/api/errors";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const [svc] = await db
      .select()
      .from(services)
      .where(eq(services.id, id))
      .limit(1);
    if (!svc) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await requireTenantAdmin(svc.tenantId);
    const items = await listKeys(svc.tenantId, svc.id);
    return NextResponse.json({ items });
  } catch (err) {
    return handleApiError(err);
  }
}

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
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

    let body;
    try {
      body = upsertSchema.parse(await req.json());
    } catch (err) {
      return NextResponse.json(
        {
          error: "validation_failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        { status: 400 },
      );
    }

    try {
      const summary = await upsertKey({
        tenantId: svc.tenantId,
        serviceId: svc.id,
        key: body.key,
        value: body.value,
      });
      // Audit every set as a guarded action — the value is NOT in the detail;
      // we record category-of-change only ("user X set key Y on service Z").
      emitGuardedAction({
        tenantId: svc.tenantId,
        actorUserId: user.id,
        action: "secret.upsert",
        resource: `service:${svc.id}/secret:${body.key}`,
        outcome: "allowed",
        detail: `key ${body.key} set on service ${svc.name}`,
      });
      return NextResponse.json(summary, { status: 201 });
    } catch (err) {
      if (err instanceof SecretValidationError) {
        return NextResponse.json(
          { error: "validation_failed", detail: err.message },
          { status: 400 },
        );
      }
      throw err;
    }
  } catch (err) {
    return handleApiError(err);
  }
}
