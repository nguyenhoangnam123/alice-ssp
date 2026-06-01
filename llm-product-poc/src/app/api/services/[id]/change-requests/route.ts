import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ulid } from "ulid";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { services, changeRequests } from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { processChangeRequest } from "@/lib/workflow/orchestrator";
import { handleApiError } from "@/lib/api/errors";

const createCrSchema = z.object({
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: serviceId } = await ctx.params;
    const [svc] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
    if (!svc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await requireTenantAdmin(svc.tenantId);

    const rows = await db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.serviceId, serviceId))
      .orderBy(desc(changeRequests.createdAt));
    return NextResponse.json({ items: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: serviceId } = await ctx.params;
    const user = await requireUser();
    const [svc] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
    if (!svc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await requireTenantAdmin(svc.tenantId);

    const body = createCrSchema.parse(await req.json());

    const crId = ulid();
    await db.insert(changeRequests).values({
      id: crId,
      serviceId,
      requestedBy: user.id,
      summary: body.summary,
      payload: body.payload,
      status: "submitted",
    });

    processChangeRequest(crId).catch((err) => console.error("workflow failed", err));
    return NextResponse.json({ id: crId }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
