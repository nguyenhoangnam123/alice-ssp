import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import {
  services,
  changeRequests,
  serviceRevisions,
  tenants,
  llmCalls,
} from "@/lib/db/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { requireTenantAdmin, requireUser } from "@/lib/auth/rbac";
import { processChangeRequest } from "@/lib/workflow/orchestrator";
import { StatusBadge } from "@/components/status-badge";
import { CrModal } from "@/components/cr-modal";
import { RevisionsTimeline } from "@/components/revisions-timeline";
import { UsageWidget } from "@/components/usage-widget";
import { ServiceTabs } from "@/components/service-tabs";
import { McpAuditLogs, type AuditEvent } from "@/components/mcp-audit-logs";
import { SecretKeysReadonly } from "@/components/secret-keys-readonly";
import { guardedActions } from "@/lib/db/schema";
import { listKeys as listSecretKeys } from "@/lib/secrets/manager";

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
      existenceStatus: serviceRevisions.existenceStatus,
      healthStatus: serviceRevisions.healthStatus,
      lastProbedAt: serviceRevisions.lastProbedAt,
      routeHost: serviceRevisions.routeHost,
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

  // ---- Per-tenant Bedrock usage for the widget. Same source-of-truth llm_calls
  // table the orchestrator's checkBudget() reads. Limited to month-to-date so a
  // long-running tenant doesn't pull down the whole history on every page render.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const usageAgg = await db
    .select({
      callsThisMonth: sql<string>`count(*)`,
      monthSpent: sql<string>`coalesce(sum(${llmCalls.costUsd}), 0)`,
    })
    .from(llmCalls)
    .where(
      and(
        eq(llmCalls.tenantId, svc.tenantId),
        gte(llmCalls.createdAt, monthStart),
      ),
    );
  const recentCallsRows = await db
    .select({
      id: llmCalls.id,
      model: llmCalls.modelId,
      inputTokens: llmCalls.inputTokens,
      outputTokens: llmCalls.outputTokens,
      cacheReadTokens: llmCalls.cacheReadTokens,
      costUsd: llmCalls.costUsd,
      latencyMs: llmCalls.latencyMs,
      createdAt: llmCalls.createdAt,
      crId: llmCalls.changeRequestId,
    })
    .from(llmCalls)
    .where(eq(llmCalls.tenantId, svc.tenantId))
    .orderBy(desc(llmCalls.createdAt))
    .limit(8);
  const usage = {
    monthSpentUsd: Number(usageAgg[0]?.monthSpent ?? "0"),
    monthCapUsd: Number(tenant?.bedrockMonthlyCapUsd ?? "5"),
    callsThisMonth: Number(usageAgg[0]?.callsThisMonth ?? "0"),
    recentCalls: recentCallsRows.map((r) => ({
      id: r.id,
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      costUsd: Number(r.costUsd),
      latencyMs: r.latencyMs,
      createdAt: r.createdAt.toISOString(),
      crId: r.crId,
    })),
  };

  // ---- Read-only listing of the secret KEYS currently set on this service.
  // Editing is by CR only — accessed through the "Request changes" button at
  // the top of the page, not from any form on this tab.
  let secretKeys: { key: string; masked: string }[] = [];
  try {
    secretKeys = await listSecretKeys(svc.tenantId, svc.id);
  } catch (err) {
    console.warn("listSecretKeys failed (non-fatal)", err);
  }

  // ---- MCP audit logs (for the third tab). Pulls last 50 of each, merges by
  // ts desc, caps at 100. Both tables are tenant-scoped.
  const recentLlm = await db
    .select({
      id: llmCalls.id,
      model: llmCalls.modelId,
      inputTokens: llmCalls.inputTokens,
      outputTokens: llmCalls.outputTokens,
      cacheReadTokens: llmCalls.cacheReadTokens,
      costUsd: llmCalls.costUsd,
      latencyMs: llmCalls.latencyMs,
      createdAt: llmCalls.createdAt,
      crId: llmCalls.changeRequestId,
    })
    .from(llmCalls)
    .where(eq(llmCalls.tenantId, svc.tenantId))
    .orderBy(desc(llmCalls.createdAt))
    .limit(50);
  const recentGuarded = await db
    .select({
      id: guardedActions.id,
      action: guardedActions.action,
      actorUserId: guardedActions.actorUserId,
      resource: guardedActions.resource,
      outcome: guardedActions.outcome,
      detail: guardedActions.detail,
      createdAt: guardedActions.createdAt,
    })
    .from(guardedActions)
    .where(eq(guardedActions.tenantId, svc.tenantId))
    .orderBy(desc(guardedActions.createdAt))
    .limit(50);
  const auditEvents: AuditEvent[] = [
    ...recentLlm.map<AuditEvent>((r) => ({
      kind: "llm_call",
      ts: r.createdAt.toISOString(),
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      costUsd: Number(r.costUsd),
      latencyMs: r.latencyMs,
      crId: r.crId,
    })),
    ...recentGuarded.map<AuditEvent>((r) => ({
      kind: "guarded_action",
      ts: r.createdAt.toISOString(),
      action: r.action,
      actorUserId: r.actorUserId,
      resource: r.resource,
      outcome: r.outcome,
      detail: r.detail,
    })),
  ]
    .sort((a, b) => (a.ts < b.ts ? 1 : -1))
    .slice(0, 100);

  // Serialize for the client component (Date → ISO string, widen enum types to string).
  const revisionsForClient = revs.map((r) => ({
    id: r.id,
    serviceStatus: r.serviceStatus as string,
    crStatus: r.crStatus as string,
    existenceStatus: r.existenceStatus,
    healthStatus: r.healthStatus,
    lastProbedAt: r.lastProbedAt?.toISOString() ?? null,
    routeHost: r.routeHost,
    aiSummary: r.aiSummary,
    cdManifestRef: r.cdManifestRef,
    dockerfileSnapshot: r.dockerfileSnapshot,
    ciPipelineRef: r.ciPipelineRef,
    createdAt: r.createdAt.toISOString(),
    crSummary: r.crSummary,
    crStatusHistory: (r.crStatusHistory ?? []) as {
      status: string;
      at: string;
      detail?: string;
    }[],
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

      <ServiceTabs
        tabs={[
          {
            id: "versions",
            label: "Versions",
            content: (
              <div className="space-y-6">
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
                              <Link href={`/dashboard/change-requests/${c.id}`}>
                                {c.summary}
                              </Link>
                            </td>
                            <td>
                              <StatusBadge value={c.status} />
                            </td>
                            <td className="text-muted text-sm">
                              {c.createdAt.toISOString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            ),
          },
          {
            id: "ai",
            label: "AI settings",
            content: (
              <div className="space-y-6">
                <UsageWidget
                  monthSpentUsd={usage.monthSpentUsd}
                  monthCapUsd={usage.monthCapUsd}
                  callsThisMonth={usage.callsThisMonth}
                  recentCalls={usage.recentCalls}
                />
                <SecretKeysReadonly items={secretKeys} />
              </div>
            ),
          },
          {
            id: "audit",
            label: "MCP audit logs",
            content: <McpAuditLogs events={auditEvents} />,
          },
        ]}
      />
    </section>
  );
}
