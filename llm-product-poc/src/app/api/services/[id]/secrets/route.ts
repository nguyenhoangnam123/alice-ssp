// GET   /api/services/[id]/secrets   — list keys (NEVER values)
// POST  /api/services/[id]/secrets   — create a SECRET change-request that
//                                       parks the value in a pending SM path;
//                                       admin approval applies it.
//
// Auth: requireTenantAdmin against the service's tenant. The plaintext value
// is uploaded to AWS Secrets Manager at submission time under a pending path
// keyed by the new CR id; the portal DB never holds it. AI agent NEVER sees
// secret values — the orchestrator short-circuits on payload.kind === "secret".

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { services, changeRequests } from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import {
  listKeys,
  writePending,
  validateKey,
  validateValue,
  SecretValidationError,
} from "@/lib/secrets/manager";
import { processChangeRequest } from "@/lib/workflow/orchestrator";
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
      validateKey(body.key);
      validateValue(body.value);
    } catch (err) {
      if (err instanceof SecretValidationError) {
        return NextResponse.json(
          { error: "validation_failed", detail: err.message },
          { status: 400 },
        );
      }
      throw err;
    }

    // 1. Create the CR row first so we have an id to key the pending blob by.
    //    payload.kind === "secret" tells the orchestrator + UI this is a
    //    secret CR — no AI, no PR; admin approval is the only path forward.
    const crId = ulid();
    await db.insert(changeRequests).values({
      id: crId,
      serviceId: svc.id,
      requestedBy: user.id,
      summary: `Set secret ${body.key} on ${svc.name}`,
      payload: {
        kind: "secret",
        action: "upsert",
        key: body.key,
      },
      status: "submitted",
    });

    // 2. Park the value in a pending SM path. Failure here rolls the CR back
    //    so we don't have an orphan CR pointing at a non-existent pending
    //    blob.
    try {
      await writePending({
        tenantId: svc.tenantId,
        serviceId: svc.id,
        crId,
        payload: { action: "upsert", key: body.key, value: body.value },
      });
    } catch (err) {
      await db.delete(changeRequests).where(eq(changeRequests.id, crId));
      throw err;
    }

    emitGuardedAction({
      tenantId: svc.tenantId,
      actorUserId: user.id,
      action: "secret.cr_submitted",
      resource: `service:${svc.id}/secret:${body.key}`,
      outcome: "allowed",
      detail: `secret CR ${crId} submitted for key ${body.key} (pending platform approval)`,
    });

    // 3. Fire the orchestrator; it'll detect kind=secret and transition
    //    straight to platform_reviewing.
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
