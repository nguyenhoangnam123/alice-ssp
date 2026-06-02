import { ulid } from "ulid";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  services,
  changeRequests,
  serviceRevisions,
  tenants,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runPolicyGate } from "@/lib/policy/gate";
import { generateArtifacts, type AgentResult } from "@/lib/ai/agent";
import { openFleetPr } from "@/lib/github/pr";

/**
 * Workflow model:
 *   change_requests.status moves through:
 *     submitted → policy_gate_passed → ai_validation_passed
 *               → ai_artifacts_generated → platform_reviewing → applied
 *   On the rejection paths it stops at policy_gate_rejected or ai_validation_rejected.
 *
 *   change_requests.status_history is an append-only [{status, at, detail?}] log of
 *   every transition — the audit trail you scroll through in the UI.
 *
 *   service_revisions has exactly ONE row per CR (UNIQUE on change_request_id). It's
 *   the immutable artifact record: dockerfile snapshot, helm/argocd refs, AI summary,
 *   PR URL. Rejected CRs also get a row, with rejection reason in ai_summary.
 */

type CrStatus =
  | "submitted"
  | "policy_gate_passed"
  | "policy_gate_rejected"
  | "ai_validation_passed"
  | "ai_validation_rejected"
  | "ai_artifacts_generated"
  | "platform_reviewing"
  | "applied"
  | "rejected";

type SvcStatus =
  | "na"
  | "aiReview"
  | "platformReview"
  | "provisioning"
  | "working"
  | "rejected";

export async function processChangeRequest(changeRequestId: string): Promise<{
  state: string;
  prUrl?: string;
  reason?: string;
}> {
  const [cr] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, changeRequestId))
    .limit(1);
  if (!cr) throw new Error(`ChangeRequest ${changeRequestId} not found`);

  const [svc] = await db.select().from(services).where(eq(services.id, cr.serviceId)).limit(1);
  if (!svc) throw new Error(`Service ${cr.serviceId} not found`);

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, svc.tenantId)).limit(1);
  if (!tenant) throw new Error(`Tenant ${svc.tenantId} not found`);

  // --- Step 1 — deterministic policy gate -----------------------------------------------
  const gate = await runPolicyGate({ service: svc, tenant });
  if (!gate.ok) {
    await transition(cr.id, "policy_gate_rejected", gate.violations.join("; "));
    await setServiceStatus(svc.id, "rejected");
    await upsertRevision({
      crId: cr.id,
      svcId: svc.id,
      svcStatus: "rejected",
      crStatus: "policy_gate_rejected",
      existenceStatus: "rejected",
      aiSummary: `**Step**: Policy gate rejected\n\n**Reason**: ${gate.violations.join("; ")}\n\n**Current state**: Service unchanged.\n\n**Desired state**: (rejected — see reason above)`,
    });
    return { state: "rejected", reason: gate.violations.join("; ") };
  }
  await transition(cr.id, "policy_gate_passed");
  await setServiceStatus(svc.id, "aiReview");

  // --- Step 2 — AI call (one round trip, two CR transitions: validation + generation) ---
  let result: AgentResult;
  try {
    result = await generateArtifacts({
      service: svc,
      tenant,
      changeRequest: cr,
      currentStateSummary: "(initial submission)",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("AI agent failed", msg);
    await transition(cr.id, "ai_validation_rejected", `AI agent error: ${msg}`);
    await setServiceStatus(svc.id, "rejected");
    await upsertRevision({
      crId: cr.id,
      svcId: svc.id,
      svcStatus: "rejected",
      crStatus: "ai_validation_rejected",
      existenceStatus: "rejected",
      aiSummary: `**Step**: AI agent error\n\n**Reason**: ${msg}`,
    });
    return { state: "rejected", reason: `AI agent error: ${msg}` };
  }

  if (result.kind === "rejected") {
    await transition(cr.id, "ai_validation_rejected", result.reason);
    await setServiceStatus(svc.id, "rejected");
    await upsertRevision({
      crId: cr.id,
      svcId: svc.id,
      svcStatus: "rejected",
      crStatus: "ai_validation_rejected",
      existenceStatus: "rejected",
      aiSummary: `**Step**: AI validation rejected\n\n**Reason**: ${result.reason}\n\n**Current state**: Service unchanged.\n\n**Desired state**: (rejected — see reason above)`,
    });
    return { state: "rejected", reason: result.reason };
  }

  await transition(cr.id, "ai_validation_passed");
  await transition(cr.id, "ai_artifacts_generated");

  // The revision row exists from this point on. Populate it with the AI's artifacts;
  // the PR URL is added below when openFleetPr returns.
  // The revision exists from this point on with existence_status='created'. Route host
  // is captured here so the prober can start probing the moment the service goes live.
  const routeHost = deriveHost(svc, tenant);
  await upsertRevision({
    crId: cr.id,
    svcId: svc.id,
    svcStatus: "aiReview",
    crStatus: "ai_artifacts_generated",
    existenceStatus: "created",
    routeHost,
    aiSummary: result.artifacts.summary,
    dockerfileSnapshot: result.artifacts.dockerfile,
    ciPipelineRef: result.artifacts.ciPipelineRef,
  });

  // --- Step 3 — open the PR -------------------------------------------------------------
  const pr = await openFleetPr({
    tenant,
    service: svc,
    changeRequest: cr,
    artifacts: result.artifacts,
  });

  await transition(cr.id, "platform_reviewing", `PR opened: ${pr.url}`);
  await setServiceStatus(svc.id, "platformReview");
  await upsertRevision({
    crId: cr.id,
    svcId: svc.id,
    svcStatus: "platformReview",
    crStatus: "platform_reviewing",
    existenceStatus: "created",
    routeHost,
    aiSummary: result.artifacts.summary,
    dockerfileSnapshot: result.artifacts.dockerfile,
    ciPipelineRef: result.artifacts.ciPipelineRef,
    cdManifestRef: pr.url,
  });

  return { state: "platform_reviewing", prUrl: pr.url };
}

/** PR-merge webhook (and the manual admin endpoint). */
export async function markProvisioned(changeRequestId: string) {
  const [cr] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, changeRequestId))
    .limit(1);
  if (!cr) throw new Error("change request not found");

  await transition(cr.id, "applied", "PR merged + ArgoCD synced");
  await setServiceStatus(cr.serviceId, "working");
  // Flip the revision's CR-status mirror to applied so the UI badge tracks it. Existence
  // already 'created' from the platform_reviewing step; the prober owns health from here.
  await db
    .update(serviceRevisions)
    .set({ crStatus: "applied", serviceStatus: "working" })
    .where(eq(serviceRevisions.changeRequestId, cr.id));
}

// ----- helpers -------------------------------------------------------------------------

async function transition(crId: string, newStatus: CrStatus, detail?: string) {
  const event = { status: newStatus, at: new Date().toISOString(), ...(detail ? { detail } : {}) };
  await db
    .update(changeRequests)
    .set({
      status: newStatus,
      updatedAt: new Date(),
      // jsonb append via Postgres expression; safer than read-modify-write at the app layer.
      statusHistory: sql`coalesce(${changeRequests.statusHistory}, '[]'::jsonb) || ${JSON.stringify([event])}::jsonb`,
    })
    .where(eq(changeRequests.id, crId));
}

function deriveHost(
  svc: { name: string; subdomain: string | null },
  tenant: { domain: string },
): string | null {
  if (!svc.subdomain) return null;
  // FQDN convention from prompts.ts: if subdomain contains a dot, use it verbatim;
  // otherwise concat to the SSP zone.
  return svc.subdomain.includes(".")
    ? svc.subdomain
    : `${svc.subdomain}.${tenant.domain}.ssp.mightybee.dev`;
}

async function setServiceStatus(svcId: string, status: SvcStatus) {
  await db
    .update(services)
    .set({ currentStatus: status, updatedAt: new Date() })
    .where(eq(services.id, svcId));
}

async function upsertRevision(args: {
  crId: string;
  svcId: string;
  svcStatus: SvcStatus;
  crStatus: CrStatus;
  existenceStatus?: "created" | "rejected" | null;
  routeHost?: string | null;
  aiSummary?: string;
  ciPipelineRef?: string;
  dockerfileSnapshot?: string;
  cdManifestRef?: string;
}) {
  const updates = {
    serviceStatus: args.svcStatus,
    crStatus: args.crStatus,
    aiSummary: args.aiSummary,
    ciPipelineRef: args.ciPipelineRef,
    dockerfileSnapshot: args.dockerfileSnapshot,
    cdManifestRef: args.cdManifestRef,
    ...(args.existenceStatus !== undefined
      ? { existenceStatus: args.existenceStatus }
      : {}),
    ...(args.routeHost !== undefined ? { routeHost: args.routeHost } : {}),
  };
  await db
    .insert(serviceRevisions)
    .values({
      id: ulid(),
      changeRequestId: args.crId,
      serviceId: args.svcId,
      ...updates,
    })
    .onConflictDoUpdate({
      target: serviceRevisions.changeRequestId,
      set: updates,
    });
}
