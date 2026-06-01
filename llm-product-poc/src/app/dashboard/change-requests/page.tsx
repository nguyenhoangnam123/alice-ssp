import Link from "next/link";
import { db } from "@/lib/db";
import { changeRequests, services } from "@/lib/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { listAccessibleTenantIds, requireUser } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/status-badge";

export default async function ChangeRequestsPage() {
  await requireUser();
  const tenantIds = await listAccessibleTenantIds();

  if (tenantIds.length === 0) {
    return (
      <section>
        <h1 className="text-xl">Change requests</h1>
        <p className="text-muted">No tenants accessible.</p>
      </section>
    );
  }

  const rows = await db
    .select({
      id: changeRequests.id,
      summary: changeRequests.summary,
      status: changeRequests.status,
      createdAt: changeRequests.createdAt,
      serviceName: services.name,
    })
    .from(changeRequests)
    .innerJoin(services, eq(services.id, changeRequests.serviceId))
    .where(inArray(services.tenantId, tenantIds))
    .orderBy(desc(changeRequests.createdAt));

  return (
    <section>
      <h1 className="text-xl mb-4">Change requests</h1>
      {rows.length === 0 ? (
        <p className="text-muted">None.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>service</th>
              <th>summary</th>
              <th>status</th>
              <th>created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cr) => (
              <tr key={cr.id}>
                <td className="text-muted font-mono">{cr.serviceName}</td>
                <td>
                  <Link href={`/dashboard/change-requests/${cr.id}`}>{cr.summary}</Link>
                </td>
                <td>
                  <StatusBadge value={cr.status} />
                </td>
                <td className="text-muted text-sm">{cr.createdAt.toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
