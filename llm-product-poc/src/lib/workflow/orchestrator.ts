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
import { validateGeneratedArtifacts } from "@/lib/policy/output-validator";
import { probeRevisionNow } from "@/lib/workflow/prober";
import {
  startSpan,
  endSpan,
  checkBudget,
  emitGuardedAction,
} from "@/lib/observability";
import { generateArtifacts, type AgentResult } from "@/lib/ai/agent";
import { openFleetPr } from "@/lib/github/pr";
import { fetchCurrentArtifacts } from "@/lib/github/fetch-artifacts";

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

  // ---- Secret CRs short-circuit. The value is already in a pending SM path
  // (written by the secrets API). The AI agent must NEVER see secret values,
  // so we skip the AI invoke entirely. The CR goes straight to
  // platform_reviewing; an admin approves via /api/change-requests/<id>/approve
  // which merges the pending value into the main bundle and transitions to
  // applied. Reject drops the pending blob and transitions to rejected.
  if ((cr.payload as Record<string, unknown> | null)?.kind === "secret") {
    await transition(cr.id, "policy_gate_passed");
    await transition(cr.id, "platform_reviewing", "awaiting admin approval (secret CR)");
    await setServiceStatus(svc.id, "platformReview");
    await upsertRevision({
      crId: cr.id,
      svcId: svc.id,
      svcStatus: "platformReview",
      crStatus: "platform_reviewing",
      existenceStatus: "created",
      aiSummary: `**Step**: Secret change request\n\n**Action**: ${String((cr.payload as Record<string, unknown>).action ?? "?")} of key \`${String((cr.payload as Record<string, unknown>).key ?? "?")}\`\n\n**Status**: pending platform approval. The value is held in AWS Secrets Manager under a pending path keyed by this CR id; it never crosses the AI or this revision row.`,
    });
    return { state: "platform_reviewing" };
  }

  // Root span for the whole CR. Trace ID = CR ID so every downstream emit
  // (Bedrock call, prober probe, etc.) joins on a single key.
  const rootSpanId = startSpan({
    traceId: cr.id,
    name: "orch.process_change_request",
    attributes: { tenant_id: tenant.id, cr_id: cr.id, service_id: svc.id },
  });

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
    endSpan(rootSpanId, "error", { reason: "policy_gate" });
    return { state: "rejected", reason: gate.violations.join("; ") };
  }
  await transition(cr.id, "policy_gate_passed");
  await setServiceStatus(svc.id, "aiReview");

  // --- Step 1.5 — per-tenant Bedrock budget guard ---------------------------------------
  // Before any token is spent, refuse the call if month-to-date Bedrock spend
  // is at or over the tenant's cap. Returns spent + cap so the reviewer sees
  // exactly what triggered the block; emits a `bedrock.budget_exceeded`
  // guarded action so the audit feed surfaces it.
  const budget = await checkBudget(tenant.id);
  if (!budget.ok) {
    const reason = `Tenant Bedrock monthly cap reached: spent $${budget.spentUsd.toFixed(4)} of $${budget.capUsd.toFixed(2)}`;
    emitGuardedAction({
      tenantId: tenant.id,
      actorUserId: cr.requestedBy,
      action: "bedrock.budget_exceeded",
      resource: `change_request:${cr.id}`,
      outcome: "blocked",
      detail: reason,
    });
    await transition(cr.id, "ai_validation_rejected", reason);
    await setServiceStatus(svc.id, "rejected");
    await upsertRevision({
      crId: cr.id,
      svcId: svc.id,
      svcStatus: "rejected",
      crStatus: "ai_validation_rejected",
      existenceStatus: "rejected",
      aiSummary: `**Step**: Budget guard rejected\n\n**Reason**: ${reason}\n\n**Current state**: Service unchanged. AI was never invoked.\n\n**Desired state**: (rejected — raise cap or wait until next month)`,
    });
    endSpan(rootSpanId, "error", { reason: "budget_exceeded", spent_usd: budget.spentUsd, cap_usd: budget.capUsd });
    return { state: "rejected", reason };
  }

  // --- Step 2 — AI call (one round trip, two CR transitions: validation + generation) ---
  // Open a child span so the Bedrock call nests under it visibly. agent.ts
  // opens its own bedrock-call span inside meteredBedrockInvoke; this one is
  // the AI step wrapper so prompt construction + retries are also captured.
  const aiSpanId = startSpan({
    traceId: cr.id,
    parentSpanId: rootSpanId,
    name: "orch.ai_invoke",
    attributes: { tenant_id: tenant.id, mode: process.env.AI_MODE ?? "mock" },
  });

  // Fetch the current four files from the fleet repo. The AI uses them as
  // the BASE to merge the CR into — without this, every CR regenerates from
  // scratch and drops fields the payload doesn't mention (IRSA annotations,
  // envFrom, externalSecrets, etc.). PR #22 was the canonical incident.
  // Failures are non-fatal: helper returns all-null and the AI falls back
  // to its from-scratch path.
  const currentArtifacts = await fetchCurrentArtifacts({
    tenant,
    service: svc,
  }).catch((err) => {
    console.warn(
      `[orchestrator] fetchCurrentArtifacts failed; falling back to from-scratch generation: ${String(err)}`,
    );
    return undefined;
  });

  let result: AgentResult;
  try {
    result = await generateArtifacts({
      service: svc,
      tenant,
      changeRequest: cr,
      currentStateSummary: "(initial submission)",
      currentArtifacts,
      parentSpanId: aiSpanId,
    });
    endSpan(aiSpanId, "ok", { kind: result.kind });
  } catch (err) {
    endSpan(aiSpanId, "error", {
      error_message: err instanceof Error ? err.message : String(err),
    });
    endSpan(rootSpanId, "error", { reason: "ai_invoke_error" });
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
    endSpan(rootSpanId, "error", { reason: "ai_rejected" });
    return { state: "rejected", reason: result.reason };
  }

  // Layer 4 — deterministic re-validation of the AI's artifacts. Even if a
  // prompt-injection succeeded earlier, the parsed YAML still has to pass
  // these rules: no privileged, no hostNetwork, no hostPath, replica cap,
  // ArgoCD finalizer + tenant-namespace destination. Closes the loop on the
  // prompt-injection defence stack.
  const outputCheck = validateGeneratedArtifacts(result.artifacts);
  if (!outputCheck.ok) {
    emitGuardedAction({
      tenantId: tenant.id,
      actorUserId: cr.requestedBy,
      action: "ai.output_validation_failed",
      resource: `change_request:${cr.id}`,
      outcome: "blocked",
      detail: outputCheck.violations.join("; "),
    });
    await transition(
      cr.id,
      "ai_validation_rejected",
      `Generated YAML failed re-validation: ${outputCheck.violations.join("; ")}`,
    );
    await setServiceStatus(svc.id, "rejected");
    await upsertRevision({
      crId: cr.id,
      svcId: svc.id,
      svcStatus: "rejected",
      crStatus: "ai_validation_rejected",
      existenceStatus: "rejected",
      aiSummary: `**Step**: Output YAML re-validation rejected\n\n**Violations**:\n${outputCheck.violations.map((v) => `- ${v}`).join("\n")}\n\n**Why**: even after the AI approved, the parsed values.yaml / Application must pass the platform's deterministic re-check. Prompt-injection that survives layers 1-3 can talk the AI into anything, but it can't talk the YAML parser into anything.`,
    });
    endSpan(rootSpanId, "error", { reason: "output_revalidation_failed" });
    return { state: "rejected", reason: outputCheck.violations.join("; ") };
  }

  await transition(cr.id, "ai_validation_passed");
  await transition(cr.id, "ai_artifacts_generated");

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

  // Kick a probe now so the timeline shows a real health badge within seconds
  // instead of waiting up to the prober's 60s interval. Fire-and-forget — a failed
  // probe just updates the row to unhealthy and the periodic prober keeps retrying.
  if (routeHost) {
    const [createdRev] = await db
      .select({ id: serviceRevisions.id })
      .from(serviceRevisions)
      .where(eq(serviceRevisions.changeRequestId, cr.id))
      .limit(1);
    if (createdRev) {
      void probeRevisionNow({
        id: createdRev.id,
        serviceId: svc.id,
        routeHost,
      });
    }
  }

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

  endSpan(rootSpanId, "ok", { state: "platform_reviewing", pr_url: pr.url });
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

  // Shadow desired-state update — merge this CR's payload into services.desired_spec.
  // Git remains the source-of-truth materializer for now; this column is the
  // platform's audit-ready record of intent. See deliverable1-01 § "Desired
  // state controller (target)".
  await mergeDesiredSpec(cr.serviceId, cr.payload as Record<string, unknown> | null);
}

/**
 * Shallow-merge a CR payload into the service's desired_spec. Drops anything
 * tenant-controlled that we don't want surfaced as platform intent
 * (e.g. raw secret values — only the KEY name is recorded in `requiredSecrets`).
 */
async function mergeDesiredSpec(
  serviceId: string,
  payload: Record<string, unknown> | null,
) {
  if (!payload || typeof payload !== "object") return;

  const [svc] = await db
    .select({ spec: services.desiredSpec })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  if (!svc) return;

  const current = { ...(svc.spec as Record<string, unknown>) };

  // Secret CRs touch only the requiredSecrets list — never store the value.
  if (payload.kind === "secret") {
    const required = new Set<string>(
      Array.isArray(current.requiredSecrets)
        ? (current.requiredSecrets as string[])
        : [],
    );
    const key = String(payload.key ?? "").trim();
    if (key) {
      if (payload.action === "upsert") required.add(key);
      else if (payload.action === "delete") required.delete(key);
    }
    current.requiredSecrets = [...required].sort();
  } else {
    // Service-config CRs: shallow merge the documented spec keys. We
    // explicitly DO NOT spread the whole payload — that would let a CR set
    // arbitrary fields on the spec.
    const spec: Record<string, unknown> = current;
    for (const key of ["replicaCount", "image", "route", "service"] as const) {
      if (payload[key] !== undefined) spec[key] = payload[key];
    }
    if (payload.resources && typeof payload.resources === "object") {
      spec.resources = {
        ...((spec.resources as Record<string, unknown>) ?? {}),
        ...payload.resources,
      };
    }
    if (Array.isArray(payload.env)) {
      // env is a name/value array; merge by name so a CR can update one var
      // without rewriting all.
      type EnvVar = { name: string; value: string };
      const existing: EnvVar[] = Array.isArray(spec.env)
        ? (spec.env as EnvVar[])
        : [];
      const byName = new Map(existing.map((e) => [e.name, e]));
      for (const e of payload.env as EnvVar[]) {
        if (e && typeof e === "object" && typeof e.name === "string") {
          byName.set(e.name, e);
        }
      }
      spec.env = [...byName.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }
  }

  await db
    .update(services)
    .set({ desiredSpec: current, updatedAt: new Date() })
    .where(eq(services.id, serviceId));
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
  _tenant: { domain: string },
): string | null {
  if (!svc.subdomain) return null;
  // Single-level convention enforced by policy gate: bare label → <sub>.ssp.mightybee.dev,
  // or already a one-level FQDN → use verbatim. Tenant is metadata; the URL never carries it.
  return svc.subdomain.includes(".")
    ? svc.subdomain
    : `${svc.subdomain}.ssp.mightybee.dev`;
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
