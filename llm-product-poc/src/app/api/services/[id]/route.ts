import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { requireTenantAdmin } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/errors";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const [s] = await db.select().from(services).where(eq(services.id, id)).limit(1);
    if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await requireTenantAdmin(s.tenantId);
    return NextResponse.json(s);
  } catch (err) {
    return handleApiError(err);
  }
}
