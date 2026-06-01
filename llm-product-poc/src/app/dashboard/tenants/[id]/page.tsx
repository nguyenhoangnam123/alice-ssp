import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { tenants, services } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireTenantAdmin } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/status-badge";

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireTenantAdmin(id);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) notFound();

  const svcs = await db.select().from(services).where(eq(services.tenantId, id));

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-xl">
          {tenant.domain}{" "}
          <span className="text-muted text-sm font-normal">— {tenant.department}</span>
        </h1>
        <p className="text-muted text-sm">head: {tenant.headOfDepartment}</p>
        <p className="font-mono text-xs text-muted mt-1">
          {Object.entries(tenant.tags ?? {})
            .map(([k, v]) => `${k}=${v}`)
            .join(" ") || "(no tags)"}
        </p>
      </header>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg">Services</h2>
          <Link href={`/dashboard/services/new?tenant=${tenant.id}`}>
            <button>New service</button>
          </Link>
        </div>
        {svcs.length === 0 ? (
          <p className="text-muted">No services yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>subdomain</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {svcs.map((s) => (
                <tr key={s.id}>
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
      </div>
    </section>
  );
}
