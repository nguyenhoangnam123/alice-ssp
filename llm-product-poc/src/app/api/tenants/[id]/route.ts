import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { requireTenantAdmin } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/errors";

const updateTenantSchema = z.object({
  // domain is immutable — explicitly not in the schema.
  department: z.string().min(1).optional(),
  head_of_department: z.string().email().optional(),
  tags: z.record(z.string(), z.string()).optional(),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requireTenantAdmin(id);
    const [t] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!t) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(t);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requireTenantAdmin(id);
    const body = updateTenantSchema.parse(await req.json());

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.department !== undefined) patch.department = body.department;
    if (body.head_of_department !== undefined) patch.headOfDepartment = body.head_of_department;
    if (body.tags !== undefined) patch.tags = body.tags;

    await db.update(tenants).set(patch).where(eq(tenants.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await requireTenantAdmin(id);
    await db
      .update(tenants)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(tenants.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
