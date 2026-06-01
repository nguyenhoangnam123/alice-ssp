import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Nav } from "@/components/nav";

// All dashboard pages query the DB — force dynamic rendering for the whole subtree.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </>
  );
}
