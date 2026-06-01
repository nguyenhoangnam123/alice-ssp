import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ulid } from "ulid";
import { inArray, isNull, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants, userTenants } from "@/lib/db/schema";
import { listAccessibleTenantIds, requireUser } from "@/lib/auth/rbac";
import { handleApiError } from "@/lib/api/errors";

const createTenantSchema = z.object({
  domain: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "domain must be lowercase letters/digits/hyphens"),
  department: z.string().min(1),
  head_of_department: z.string().email(),
  tags: z.record(z.string(), z.string()).optional().default({}),
});

export async function GET() {
  try {
    await requireUser();
    const ids = await listAccessibleTenantIds();
    if (ids.length === 0) return NextResponse.json({ items: [] });
    const rows = await db
      .select()
      .from(tenants)
      .where(and(inArray(tenants.id, ids), isNull(tenants.deletedAt)));
    return NextResponse.json({ items: rows });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = createTenantSchema.parse(await req.json());

    const id = ulid();
    await db.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id,
        domain: body.domain,
        department: body.department,
        headOfDepartment: body.head_of_department,
        tags: body.tags,
      });
      await tx.insert(userTenants).values({
        userId: user.id,
        tenantId: id,
        role: "admin",
      });
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
