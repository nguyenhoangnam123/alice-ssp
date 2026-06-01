import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { services, changeRequests } from "@/lib/db/schema";
import { requireTenantAdmin } from "@/lib/auth/rbac";
import { markProvisioned } from "@/lib/workflow/orchestrator";
import { handleApiError } from "@/lib/api/errors";

// Simulates the ArgoCD healthy webhook in MVP1.
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

    await markProvisioned(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
