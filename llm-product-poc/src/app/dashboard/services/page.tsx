import Link from "next/link";
import { db } from "@/lib/db";
import { services, tenants, changeRequests, serviceRevisions } from "@/lib/db/schema";
import { inArray, eq, desc } from "drizzle-orm";
import { listAccessibleTenantIds, requireUser } from "@/lib/auth/rbac";
import { ServicesTable } from "@/components/services-table";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  await requireUser();
  const ids = await listAccessibleTenantIds();

  if (ids.length === 0) {
    return (
      <section>
        <h1 className="text-xl">Services</h1>
        <p className="text-muted">No tenants accessible.</p>
      </section>
    );
  }

  const svcRows = await db
    .select({
      id: services.id,
      name: services.name,
      subdomain: services.subdomain,
      currentStatus: services.currentStatus,
      tenantDomain: tenants.domain,
    })
    .from(services)
    .innerJoin(tenants, eq(tenants.id, services.tenantId))
    .where(inArray(services.tenantId, ids));

  // Latest CR per service (one query per row is fine for MVP1 cardinality).
  // MVP2 should switch to a window function / LATERAL subquery.
  const rowsWithLatest = await Promise.all(
    svcRows.map(async (s) => {
      const [latestCr] = await db
        .select()
        .from(changeRequests)
        .where(eq(changeRequests.serviceId, s.id))
        .orderBy(desc(changeRequests.createdAt))
        .limit(1);
      const [latestRev] = await db
        .select()
        .from(serviceRevisions)
        .where(eq(serviceRevisions.serviceId, s.id))
        .orderBy(desc(serviceRevisions.createdAt))
        .limit(1);
      return {
        ...s,
        latestCr: latestCr
          ? {
              summary: latestCr.summary,
              status: latestCr.status,
              createdAt: latestCr.createdAt.toISOString(),
            }
          : null,
        latestAiSummary: latestRev?.aiSummary ?? null,
      };
    }),
  );

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl">Services</h1>
        <Link href="/dashboard/services/new">
          <button>New service</button>
        </Link>
      </header>
      {rowsWithLatest.length === 0 ? (
        <p className="text-muted">
          No services yet. <Link href="/dashboard/services/new">Submit one</Link>.
        </p>
      ) : (
        <ServicesTable rows={rowsWithLatest} />
      )}
    </section>
  );
}
