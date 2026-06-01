import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ulid } from "ulid";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { services, changeRequests } from "@/lib/db/schema";
import {
  listAccessibleTenantIds,
  requireTenantAdmin,
  requireUser,
} from "@/lib/auth/rbac";
import { processChangeRequest } from "@/lib/workflow/orchestrator";
import { handleApiError } from "@/lib/api/errors";

const createServiceSchema = z.object({
  tenant_id: z.string().min(1),
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "name must be lowercase letters/digits/hyphens"),
  subdomain: z
    .string()
    .regex(/^[a-z0-9-]*$/)
    .optional()
    .nullable(),
  vpn_internal: z.boolean().default(true),
  git_repo: z.string().url(),
  description: z.string().min(20),
});

export async function GET() {
  try {
    await requireUser();
    const ids = await listAccessibleTenantIds();
    if (ids.length === 0) return NextResponse.json({ items: [] });
    const rows = await db.select().from(services).where(inArray(services.tenantId, ids));
    return NextResponse.json({ items: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = createServiceSchema.parse(await req.json());
    await requireTenantAdmin(body.tenant_id);

    const serviceId = ulid();
    const crId = ulid();

    await db.transaction(async (tx) => {
      await tx.insert(services).values({
        id: serviceId,
        tenantId: body.tenant_id,
        name: body.name,
        subdomain: body.subdomain ?? null,
        vpnInternal: body.vpn_internal,
        gitRepo: body.git_repo,
        description: body.description,
        currentStatus: "na",
      });
      await tx.insert(changeRequests).values({
        id: crId,
        serviceId,
        requestedBy: user.id,
        summary: `Initial submission: ${body.name}`,
        status: "submitted",
      });
    });

    processChangeRequest(crId).catch((err) => console.error("workflow failed", err));

    return NextResponse.json({ id: serviceId, change_request_id: crId }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
