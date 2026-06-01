import Link from "next/link";
import { db } from "@/lib/db";
import { services, tenants } from "@/lib/db/schema";
import { inArray, eq } from "drizzle-orm";
import { listAccessibleTenantIds, requireUser } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/status-badge";

export default async function ServicesPage() {
  await requireUser();
  const ids = await listAccessibleTenantIds();
  const rows = ids.length
    ? await db
        .select({
          id: services.id,
          name: services.name,
          subdomain: services.subdomain,
          currentStatus: services.currentStatus,
          tenantDomain: tenants.domain,
        })
        .from(services)
        .innerJoin(tenants, eq(tenants.id, services.tenantId))
        .where(inArray(services.tenantId, ids))
    : [];

  return (
    <section>
      <header className="flex items-center justify-between mb-4">
        <h1 className="text-xl">Services</h1>
        <Link href="/dashboard/services/new">
          <button>New service</button>
        </Link>
      </header>
      {rows.length === 0 ? (
        <p className="text-muted">No services yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>tenant</th>
              <th>name</th>
              <th>subdomain</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td className="text-muted font-mono">{s.tenantDomain}</td>
                <td>
                  <Link href={`/dashboard/services/${s.id}`}>{s.name}</Link>
                </td>
                <td className="font-mono text-sm text-muted">{s.subdomain ?? "—"}</td>
                <td>
                  <StatusBadge value={s.currentStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
