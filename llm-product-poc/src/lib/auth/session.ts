import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { users, userTenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "ssp_session";

export type SessionUser = {
  id: string;
  email: string;
  cognitoSub: string;
};

/**
 * Returns the current session user, or null if not signed in.
 * AUTH_MODE=stub  — cookie holds the user_id directly
 * AUTH_MODE=cognito — cookie holds a JWT; verify via JWKS (not implemented in MVP1)
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const mode = process.env.AUTH_MODE ?? "stub";
  const store = await cookies();
  const cookie = store.get(SESSION_COOKIE);
  if (!cookie?.value) return null;

  if (mode === "stub") {
    const [u] = await db.select().from(users).where(eq(users.id, cookie.value)).limit(1);
    if (!u) return null;
    return { id: u.id, email: u.email, cognitoSub: u.cognitoSub };
  }

  // TODO MVP2: verify Cognito JWT via JWKS, then upsert user.
  throw new Error(`AUTH_MODE=${mode} not implemented in MVP1`);
}

export async function setStubSession(userId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Memberships for the current user. Returns an empty array if not signed in.
 * Source of truth for RBAC — see lib/auth/rbac.ts.
 */
export async function getSessionMemberships(userId: string) {
  return db.select().from(userTenants).where(eq(userTenants.userId, userId));
}
