import Link from "next/link";
import { db } from "@/lib/db";
import { services, changeRequests, tenants } from "@/lib/db/schema";
import { inArray, desc } from "drizzle-orm";
import { listAccessibleTenantIds, requireUser } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/status-badge";

export default async function Dashboard() {
  await requireUser();
  const tenantIds = await listAccessibleTenantIds();

  if (tenantIds.length === 0) {
    return (
      <section>
        <h1 className="text-xl mb-2">Welcome</h1>
        <p className="text-muted">
          You are not a member of any tenant yet. Ask the platform team to add you to a tenant.
        </p>
      </section>
    );
  }

  const [myTenants, recentServices, recentCrs] = await Promise.all([
    db.select().from(tenants).where(inArray(tenants.id, tenantIds)),
    db
      .select()
      .from(services)
      .where(inArray(services.tenantId, tenantIds))
      .orderBy(desc(services.updatedAt))
      .limit(10),
    db
      .select({
        id: changeRequests.id,
        serviceId: changeRequests.serviceId,
        status: changeRequests.status,
        summary: changeRequests.summary,
        updatedAt: changeRequests.updatedAt,
      })
      .from(changeRequests)
      .orderBy(desc(changeRequests.updatedAt))
      .limit(10),
  ]);

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-xl mb-2">My tenants</h1>
        <ul className="space-y-1">
          {myTenants.map((t) => (
            <li key={t.id}>
              <Link href={`/dashboard/tenants/${t.id}`}>{t.domain}</Link>{" "}
              <span className="text-muted text-sm">— {t.department}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="text-lg mb-2">Recent services</h2>
        {recentServices.length === 0 ? (
          <p className="text-muted">
            No services yet. <Link href="/dashboard/services/new">Submit one</Link>.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>name</th>
                <th>status</th>
                <th>updated</th>
              </tr>
            </thead>
            <tbody>
              {recentServices.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/dashboard/services/${s.id}`}>{s.name}</Link>
                  </td>
                  <td>
                    <StatusBadge value={s.currentStatus} />
                  </td>
                  <td className="text-muted text-sm">{s.updatedAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="text-lg mb-2">Recent change requests</h2>
        {recentCrs.length === 0 ? (
          <p className="text-muted">No change requests yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>summary</th>
                <th>status</th>
                <th>updated</th>
              </tr>
            </thead>
            <tbody>
              {recentCrs.map((cr) => (
                <tr key={cr.id}>
                  <td>
                    <Link href={`/dashboard/change-requests/${cr.id}`}>{cr.summary}</Link>
                  </td>
                  <td>
                    <StatusBadge value={cr.status} />
                  </td>
                  <td className="text-muted text-sm">{cr.updatedAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
