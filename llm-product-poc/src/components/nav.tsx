import Link from "next/link";
import { getSessionUser, clearSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

async function signOut() {
  "use server";
  await clearSession();
  redirect("/login");
}

export async function Nav() {
  const user = await getSessionUser();
  return (
    <nav className="border-b border-border px-6 py-3 flex items-center gap-6">
      <Link href="/dashboard" className="font-bold text-ink no-underline">
        SSP
      </Link>
      <Link href="/dashboard/tenants">Tenants</Link>
      <Link href="/dashboard/services">Services</Link>
      <Link href="/dashboard/change-requests">Change Requests</Link>
      <div className="ml-auto flex items-center gap-3 text-sm text-muted">
        {user ? (
          <>
            <span>{user.email}</span>
            <form action={signOut}>
              <button type="submit" className="secondary">
                sign out
              </button>
            </form>
          </>
        ) : (
          <Link href="/login">sign in</Link>
        )}
      </div>
    </nav>
  );
}
