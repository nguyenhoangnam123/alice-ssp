import { db } from "@/lib/db";
import { userTenants } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "./session";

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number = 401,
  ) {
    super(message);
  }
}

/**
 * Ensures the caller is signed in. Returns the SessionUser or throws AuthError(401).
 */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new AuthError("not signed in", 401);
  return user;
}

/**
 * Ensures the caller has an admin role in the given tenant. Throws AuthError(403)
 * on mismatch. Every API/server-action that touches tenant-scoped data MUST call this.
 */
export async function requireTenantAdmin(tenantId: string) {
  const user = await requireUser();
  const [row] = await db
    .select()
    .from(userTenants)
    .where(and(eq(userTenants.userId, user.id), eq(userTenants.tenantId, tenantId)))
    .limit(1);

  if (!row) throw new AuthError("forbidden: not a member of this tenant", 403);
  if (row.role !== "admin") throw new AuthError("forbidden: admin required", 403);
  return { user, tenantId, role: row.role };
}

/**
 * Returns the list of tenantIds the current user has access to.
 * Use this when listing across tenants (e.g. landing dashboard).
 */
export async function listAccessibleTenantIds(): Promise<string[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const rows = await db
    .select({ tenantId: userTenants.tenantId })
    .from(userTenants)
    .where(eq(userTenants.userId, user.id));
  return rows.map((r) => r.tenantId);
}
