import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { setStubSession } from "@/lib/auth/session";

async function stubLogin(formData: FormData) {
  "use server";
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return;
  await setStubSession(userId);
  redirect("/dashboard");
}

export default async function LoginPage() {
  const all = await db.select().from(users);

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl mb-1">SSP sign-in</h1>
      <p className="text-muted text-sm mb-6">
        Stub auth — pick a user from the seeded list. AUTH_MODE=cognito swaps this for
        Hosted UI.
      </p>

      {all.length === 0 ? (
        <p className="text-muted">
          No users yet. Run <code>npm run db:seed</code> first.
        </p>
      ) : (
        <form action={stubLogin} className="space-y-3">
          <label className="block text-sm text-muted">user</label>
          <select name="user_id" defaultValue={all[0].id}>
            {all.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </select>
          <button type="submit">Sign in</button>
        </form>
      )}
    </main>
  );
}
