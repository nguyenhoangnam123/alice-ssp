import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { sql, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { changeRequests, services, serviceRevisions } from "@/lib/db/schema";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/status-badge";
import { markProvisioned } from "@/lib/workflow/orchestrator";
import { applyPending, dropPending } from "@/lib/secrets/manager";
import { emitGuardedAction } from "@/lib/observability";

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

// Server-action analogue to the orchestrator's mergeDesiredSpec helper.
// Duplicated here intentionally — the page-level server action shouldn't
// reach into orchestrator internals. The secret variant only touches
// requiredSecrets, never the value.
async function mergeDesiredSpecForSecret(
  serviceId: string,
  payload: { action: string; key?: string },
) {
  const [svc] = await db
    .select({ spec: services.desiredSpec })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!svc) return;
  const current = { ...(svc.spec as Record<string, unknown>) };
  const required = new Set<string>(
    Array.isArray(current.requiredSecrets)
      ? (current.requiredSecrets as string[])
      : [],
  );
  const key = (payload.key ?? "").trim();
  if (key) {
    if (payload.action === "upsert") required.add(key);
    else if (payload.action === "delete") required.delete(key);
  }
  current.requiredSecrets = [...required].sort();
  await db
    .update(services)
    .set({ desiredSpec: current, updatedAt: new Date() })
    .where(eq(services.id, serviceId));
}

async function approveSecret(formData: FormData) {
  "use server";
  const crId = String(formData.get("cr_id") ?? "");
  const user = await requireUser();
  const [cr] = await db.select().from(changeRequests).where(eq(changeRequests.id, crId)).limit(1);
  if (!cr) throw new Error("CR not found");
  const [svc] = await db.select().from(services).where(eq(services.id, cr.serviceId)).limit(1);
  if (!svc) throw new Error("service not found");
  await requireTenantAdmin(svc.tenantId);
  const payload = (cr.payload ?? {}) as Record<string, unknown>;
  if (payload.kind !== "secret") throw new Error("not a secret CR");
  if (cr.status !== "platform_reviewing") throw new Error(`CR in status ${cr.status}, not approvable`);

  const result = await applyPending({ tenantId: svc.tenantId, serviceId: svc.id, crId });
  if (!result.ok) throw new Error(result.reason);

  const event = {
    status: "applied" as const,
    at: new Date().toISOString(),
    detail: `approved by ${user.id}; ${result.action} ${result.key}${result.masked ? " → " + result.masked : ""}`,
  };
  await db
    .update(changeRequests)
    .set({
      status: "applied",
      updatedAt: new Date(),
      statusHistory: sql`coalesce(${changeRequests.statusHistory}, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb`,
    })
    .where(eq(changeRequests.id, crId));
  await db
    .update(serviceRevisions)
    .set({ crStatus: "applied", serviceStatus: "working" })
    .where(eq(serviceRevisions.changeRequestId, crId));
  // Update the shadow desired_spec.requiredSecrets list now that the change
  // is applied. Same merge semantics as the orchestrator's helper.
  await mergeDesiredSpecForSecret(svc.id, {
    action: result.action,
    key: result.key,
  });

  emitGuardedAction({
    tenantId: svc.tenantId,
    actorUserId: user.id,
    action: "secret.approved",
    resource: `change_request:${crId}/secret:${result.key}`,
    outcome: "allowed",
    detail: `admin approved CR ${crId}: ${result.action} ${result.key}`,
  });
  redirect(`/dashboard/change-requests/${crId}`);
}

async function rejectSecret(formData: FormData) {
  "use server";
  const crId = String(formData.get("cr_id") ?? "");
  const user = await requireUser();
  const [cr] = await db.select().from(changeRequests).where(eq(changeRequests.id, crId)).limit(1);
  if (!cr) throw new Error("CR not found");
  const [svc] = await db.select().from(services).where(eq(services.id, cr.serviceId)).limit(1);
  if (!svc) throw new Error("service not found");
  await requireTenantAdmin(svc.tenantId);
  const payload = (cr.payload ?? {}) as Record<string, unknown>;
  if (payload.kind !== "secret") throw new Error("not a secret CR");
  if (cr.status !== "platform_reviewing") throw new Error(`CR in status ${cr.status}, not rejectable`);

  await dropPending(svc.tenantId, svc.id, crId);
  const event = {
    status: "rejected" as const,
    at: new Date().toISOString(),
    detail: `rejected by ${user.id}; staged value dropped`,
  };
  await db
    .update(changeRequests)
    .set({
      status: "rejected",
      updatedAt: new Date(),
      statusHistory: sql`coalesce(${changeRequests.statusHistory}, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb`,
    })
    .where(eq(changeRequests.id, crId));
  await db
    .update(serviceRevisions)
    .set({ crStatus: "rejected", serviceStatus: "rejected", existenceStatus: "rejected" })
    .where(eq(serviceRevisions.changeRequestId, crId));
  emitGuardedAction({
    tenantId: svc.tenantId,
    actorUserId: user.id,
    action: "secret.rejected",
    resource: `change_request:${crId}/secret:${payload.key}`,
    outcome: "blocked",
    detail: `admin rejected CR ${crId}`,
  });
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

  const payload = (cr.payload ?? {}) as Record<string, unknown>;
  const isSecretCr = payload.kind === "secret";
  const canSecretApprove = isSecretCr && cr.status === "platform_reviewing";

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

      {isSecretCr && (
        <div className="rounded border border-border p-3 space-y-2">
          <p className="text-sm">
            <strong>Secret change request</strong> — action <code>{String(payload.action)}</code> on key{" "}
            <code>{String(payload.key)}</code>.
          </p>
          <p className="text-xs text-muted">
            The value lives in AWS Secrets Manager at <code>ssp/&lt;tenant&gt;/&lt;service&gt;/secrets-pending/{cr.id}</code> until you decide.
            Approve merges it into the live bundle; reject drops the staged blob.
          </p>
          {canSecretApprove ? (
            <div className="flex gap-2">
              <form action={approveSecret}>
                <input type="hidden" name="cr_id" value={cr.id} />
                <button type="submit">Approve</button>
              </form>
              <form action={rejectSecret}>
                <input type="hidden" name="cr_id" value={cr.id} />
                <button type="submit" className="secondary">Reject</button>
              </form>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Already in terminal state: <code>{cr.status}</code>.
            </p>
          )}
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
