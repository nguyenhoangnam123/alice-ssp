import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { services, changeRequests, serviceRevisions } from "@/lib/db/schema";
import { requireTenantAdmin } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/errors";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [cr] = await db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.id, id))
      .limit(1);
    if (!cr) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const [svc] = await db
      .select()
      .from(services)
      .where(eq(services.id, cr.serviceId))
      .limit(1);
    if (!svc) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await requireTenantAdmin(svc.tenantId);

    const revs = await db
      .select()
      .from(serviceRevisions)
      .where(eq(serviceRevisions.changeRequestId, cr.id))
      .orderBy(desc(serviceRevisions.createdAt));

    return NextResponse.json({ change_request: cr, revisions: revs });
  } catch (err) {
    return handleApiError(err);
  }
}
