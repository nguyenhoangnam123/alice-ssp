import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { services, changeRequests, serviceRevisions, tenants } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { processChangeRequest } from "@/lib/workflow/orchestrator";
import { StatusBadge } from "@/components/status-badge";

async function newChangeRequest(formData: FormData) {
  "use server";
  const user = await requireUser();
  const serviceId = String(formData.get("service_id") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) throw new Error("summary required");

  const [svc] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  if (!svc) throw new Error("service not found");
  await requireTenantAdmin(svc.tenantId);

  const crId = ulid();
  await db.insert(changeRequests).values({
    id: crId,
    serviceId,
    requestedBy: user.id,
    summary,
    status: "submitted",
  });

  processChangeRequest(crId).catch((err) => console.error("workflow failed", err));
  redirect(`/dashboard/change-requests/${crId}`);
}

export default async function ServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [svc] = await db.select().from(services).where(eq(services.id, id)).limit(1);
  if (!svc) notFound();
  await requireTenantAdmin(svc.tenantId);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, svc.tenantId)).limit(1);
  const crs = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.serviceId, svc.id))
    .orderBy(desc(changeRequests.createdAt));
  const revs = await db
    .select()
    .from(serviceRevisions)
    .where(eq(serviceRevisions.serviceId, svc.id))
    .orderBy(desc(serviceRevisions.createdAt))
    .limit(20);

  return (
    <section className="space-y-6">
      <header>
        <p className="text-muted text-sm">
          <Link href={`/dashboard/tenants/${tenant?.id ?? ""}`}>{tenant?.domain}</Link> /
        </p>
        <h1 className="text-xl">
          {svc.name} <StatusBadge value={svc.currentStatus} />
        </h1>
        <p className="text-muted text-sm">
          repo: <a href={svc.gitRepo}>{svc.gitRepo}</a>
        </p>
        <p className="text-sm mt-2">{svc.description}</p>
      </header>

      <div>
        <h2 className="text-lg mb-2">Submit a change request</h2>
        <form action={newChangeRequest} className="flex gap-2">
          <input type="hidden" name="service_id" value={svc.id} />
          <input name="summary" placeholder="e.g. bump replicas to 4" required />
          <button type="submit">Submit CR</button>
        </form>
      </div>

      <div>
        <h2 className="text-lg mb-2">Change requests</h2>
        {crs.length === 0 ? (
          <p className="text-muted">None.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>summary</th>
                <th>status</th>
                <th>created</th>
              </tr>
            </thead>
            <tbody>
              {crs.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/dashboard/change-requests/${c.id}`}>{c.summary}</Link>
                  </td>
                  <td>
                    <StatusBadge value={c.status} />
                  </td>
                  <td className="text-muted text-sm">{c.createdAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="text-lg mb-2">Revision history</h2>
        {revs.length === 0 ? (
          <p className="text-muted">None.</p>
        ) : (
          <ol className="border-l border-border pl-4 space-y-3">
            {revs.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <StatusBadge value={r.serviceStatus} />
                  <StatusBadge value={r.crStatus} />
                  <span className="text-muted text-xs">{r.createdAt.toISOString()}</span>
                </div>
                {r.aiSummary && <p className="text-muted mt-1">{r.aiSummary}</p>}
                {r.cdManifestRef && (
                  <p className="text-xs mt-1">
                    PR: <a href={r.cdManifestRef}>{r.cdManifestRef}</a>
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
