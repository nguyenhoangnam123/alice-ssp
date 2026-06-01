import Link from "next/link";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { inArray, isNull, and } from "drizzle-orm";
import { listAccessibleTenantIds, requireUser } from "@/lib/auth/rbac";

export default async function TenantsPage() {
  await requireUser();
  const ids = await listAccessibleTenantIds();
  const rows = ids.length
    ? await db
        .select()
        .from(tenants)
        .where(and(inArray(tenants.id, ids), isNull(tenants.deletedAt)))
    : [];

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl">Tenants</h1>
        <Link href="/dashboard/tenants/new">
          <button>New tenant</button>
        </Link>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted">No tenants you have access to.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>domain</th>
              <th>department</th>
              <th>head</th>
              <th>tags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/dashboard/tenants/${t.id}`}>{t.domain}</Link>
                </td>
                <td>{t.department}</td>
                <td>{t.headOfDepartment}</td>
                <td className="font-mono text-xs text-muted">
                  {Object.entries(t.tags ?? {})
                    .map(([k, v]) => `${k}=${v}`)
                    .join(" ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
