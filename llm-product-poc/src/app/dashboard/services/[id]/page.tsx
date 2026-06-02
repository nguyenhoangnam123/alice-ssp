import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import { services, changeRequests, serviceRevisions, tenants } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { processChangeRequest } from "@/lib/workflow/orchestrator";
import { StatusBadge } from "@/components/status-badge";
import { CrModal } from "@/components/cr-modal";
import { RevisionsTimeline } from "@/components/revisions-timeline";

export const dynamic = "force-dynamic";

async function newChangeRequest(formData: FormData) {
  "use server";
  const user = await requireUser();
  const serviceId = String(formData.get("service_id") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();
  if (!summary) throw new Error("summary required");

  const payloadRaw = String(formData.get("payload_raw") ?? "").trim();
  let payload: Record<string, unknown> = {};
  if (payloadRaw) {
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      throw new Error("payload must be valid JSON");
    }
  }

  const [svc] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);
  if (!svc) throw new Error("service not found");
  await requireTenantAdmin(svc.tenantId);

  const crId = ulid();
  await db.insert(changeRequests).values({
    id: crId,
    serviceId,
    requestedBy: user.id,
    summary,
    payload,
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
  // Join revisions with their CR to pull the per-step workflow timeline (status_history).
  const revs = await db
    .select({
      id: serviceRevisions.id,
      serviceStatus: serviceRevisions.serviceStatus,
      crStatus: serviceRevisions.crStatus,
      aiSummary: serviceRevisions.aiSummary,
      cdManifestRef: serviceRevisions.cdManifestRef,
      dockerfileSnapshot: serviceRevisions.dockerfileSnapshot,
      ciPipelineRef: serviceRevisions.ciPipelineRef,
      createdAt: serviceRevisions.createdAt,
      crSummary: changeRequests.summary,
      crStatusHistory: changeRequests.statusHistory,
    })
    .from(serviceRevisions)
    .innerJoin(changeRequests, eq(changeRequests.id, serviceRevisions.changeRequestId))
    .where(eq(serviceRevisions.serviceId, svc.id))
    .orderBy(desc(serviceRevisions.createdAt))
    .limit(50);

  // Serialize for the client component (Date → ISO string).
  const revisionsForClient = revs.map((r) => ({
    id: r.id,
    serviceStatus: r.serviceStatus,
    crStatus: r.crStatus,
    aiSummary: r.aiSummary,
    cdManifestRef: r.cdManifestRef,
    dockerfileSnapshot: r.dockerfileSnapshot,
    ciPipelineRef: r.ciPipelineRef,
    createdAt: r.createdAt.toISOString(),
    crSummary: r.crSummary,
    crStatusHistory: r.crStatusHistory ?? [],
  }));

  return (
    <section className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted text-sm">
            <Link href={`/dashboard/tenants/${tenant?.id ?? ""}`}>{tenant?.domain}</Link> /
          </p>
          <h1 className="text-xl mt-1">
            {svc.name} <StatusBadge value={svc.currentStatus} />
          </h1>
          <p className="text-muted text-sm mt-1">
            repo: <a href={svc.gitRepo}>{svc.gitRepo}</a>
          </p>
          <p className="text-sm mt-2">{svc.description}</p>
        </div>
        <CrModal action={newChangeRequest} serviceId={svc.id} serviceName={svc.name} />
      </header>

      <div>
        <h2 className="text-lg mb-2">Revisions</h2>
        <RevisionsTimeline revisions={revisionsForClient} />
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
    </section>
  );
}
