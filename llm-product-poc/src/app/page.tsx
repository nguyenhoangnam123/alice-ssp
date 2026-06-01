import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";

// Reads cookie (and thus the DB via getSessionUser) — always dynamic.
export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  redirect("/login");
}
