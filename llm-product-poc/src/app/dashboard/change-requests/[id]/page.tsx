import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { changeRequests, services, serviceRevisions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireTenantAdmin } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/status-badge";
import { markProvisioned } from "@/lib/workflow/orchestrator";

async function simulateMerge(formData: FormData) {
  "use server";
  const crId = String(formData.get("cr_id") ?? "");
  const [cr] = await db.select().from(changeRequests).where(eq(changeRequests.id, crId)).limit(1);
  if (!cr) throw new Error("CR not found");
  const [svc] = await db.select().from(services).where(eq(services.id, cr.serviceId)).limit(1);
  if (!svc) throw new Error("service not found");
  await requireTenantAdmin(svc.tenantId);

  await markProvisioned(crId);
  redirect(`/dashboard/change-requests/${crId}`);
}

export default async function ChangeRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [cr] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, id))
    .limit(1);
  if (!cr) notFound();

  const [svc] = await db.select().from(services).where(eq(services.id, cr.serviceId)).limit(1);
  if (!svc) notFound();
  await requireTenantAdmin(svc.tenantId);

  const revs = await db
    .select()
    .from(serviceRevisions)
    .where(eq(serviceRevisions.changeRequestId, cr.id))
    .orderBy(desc(serviceRevisions.createdAt));

  const canSimulateMerge =
    cr.status === "platformReviewing" || cr.status === "approved" || cr.status === "merged";

  return (
    <section className="space-y-6">
      <header>
        <p className="text-muted text-sm">
          <Link href={`/dashboard/services/${svc.id}`}>{svc.name}</Link> /
        </p>
        <h1 className="text-xl">
          {cr.summary} <StatusBadge value={cr.status} />
        </h1>
      </header>

      {canSimulateMerge && (
        <div className="rounded border border-border p-3">
          <p className="text-sm text-muted mb-2">
            Simulate platform-engineer merge + ArgoCD sync (MVP1 stub for the webhook).
          </p>
          <form action={simulateMerge}>
            <input type="hidden" name="cr_id" value={cr.id} />
            <button type="submit" className="secondary">
              Mark as provisioned
            </button>
          </form>
        </div>
      )}

      <div>
        <h2 className="text-lg mb-2">Revisions</h2>
        {revs.length === 0 ? (
          <p className="text-muted">No revisions yet — workflow may still be running.</p>
        ) : (
          <ol className="border-l border-border pl-4 space-y-4">
            {revs.map((r) => (
              <li key={r.id} className="text-sm">
                <div className="flex items-center gap-2">
                  <StatusBadge value={r.serviceStatus} />
                  <StatusBadge value={r.crStatus} />
                  <span className="text-muted text-xs">{r.createdAt.toISOString()}</span>
                </div>
                {r.aiSummary && <p className="mt-1">{r.aiSummary}</p>}
                {r.cdManifestRef && (
                  <p className="text-xs mt-1">
                    PR: <a href={r.cdManifestRef}>{r.cdManifestRef}</a>
                  </p>
                )}
                {r.dockerfileSnapshot && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted">
                      Dockerfile snapshot
                    </summary>
                    <pre className="bg-panel border border-border p-2 mt-1 overflow-x-auto text-xs">
                      {r.dockerfileSnapshot}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
