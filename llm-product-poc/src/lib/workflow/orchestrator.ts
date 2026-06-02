import { ulid } from "ulid";
import { db } from "@/lib/db";
import {
  services,
  changeRequests,
  serviceRevisions,
  tenants,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { runPolicyGate } from "@/lib/policy/gate";
import { generateArtifacts, type AgentResult } from "@/lib/ai/agent";
import { openFleetPr } from "@/lib/github/pr";

type Step =
  | "policy_gate_passed"
  | "policy_gate_rejected"
  | "ai_validation_passed"
  | "ai_validation_rejected"
  | "ai_artifacts_generated"
  | "pr_opened"
  | "pr_merged";

/**
 * Workflow: submitted → policy_gate_passed → ai_validation_passed →
 *           ai_artifacts_generated → pr_opened → (later) pr_merged
 *
 * Either gate or AI validation can short-circuit with a *_rejected step. One revision
 * row per step, append-only.
 */
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

  await db
    .update(services)
    .set({ currentStatus: "aiReview", updatedAt: new Date() })
    .where(eq(services.id, svc.id));
  await db
    .update(changeRequests)
    .set({ status: "aiReviewing", updatedAt: new Date() })
    .where(eq(changeRequests.id, cr.id));

  // Step 1 — deterministic policy gate
  const gate = await runPolicyGate({ service: svc, tenant });
  if (!gate.ok) {
    await writeRevision({
      crId: cr.id,
      svcId: svc.id,
      step: "policy_gate_rejected",
      serviceStatus: "rejected",
      crStatus: "rejected",
      aiSummary: `**Step**: Policy gate rejected\n\n**Reason**: ${gate.violations.join("; ")}\n\n**Current state**: Service unchanged.\n\n**Desired state**: (rejected — see reason above)`,
    });
    await setTerminalRejected(cr.id, svc.id);
    return { state: "rejected", reason: gate.violations.join("; ") };
  }
  await writeRevision({
    crId: cr.id,
    svcId: svc.id,
    step: "policy_gate_passed",
    serviceStatus: "aiReview",
    crStatus: "aiReviewing",
    aiSummary:
      "**Step**: Policy gate passed\n\nDeterministic checks ok: description length, https git_repo, unique subdomain, tenant active.",
  });

  // Step 2 — AI call (one Bedrock round trip, two logical steps: validation + generation)
  const [previous] = await db
    .select()
    .from(serviceRevisions)
    .where(eq(serviceRevisions.serviceId, svc.id))
    .orderBy(desc(serviceRevisions.createdAt))
    .limit(1);
  const currentStateSummary = previous
    ? `Most recent revision: ${previous.createdAt.toISOString()}, service_status=${previous.serviceStatus}, cr_status=${previous.crStatus}.`
    : "(new service — no previous revision)";

  let result: AgentResult;
  try {
    result = await generateArtifacts({
      service: svc,
      tenant,
      changeRequest: cr,
      currentStateSummary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("AI agent failed", msg);
    await writeRevision({
      crId: cr.id,
      svcId: svc.id,
      step: "ai_validation_rejected",
      serviceStatus: "rejected",
      crStatus: "rejected",
      aiSummary: `**Step**: AI agent error\n\n**Reason**: ${msg}`,
    });
    await setTerminalRejected(cr.id, svc.id);
    return { state: "rejected", reason: `AI agent error: ${msg}` };
  }

  if (result.kind === "rejected") {
    await writeRevision({
      crId: cr.id,
      svcId: svc.id,
      step: "ai_validation_rejected",
      serviceStatus: "rejected",
      crStatus: "rejected",
      aiSummary: `**Step**: AI validation rejected\n\n**Reason**: ${result.reason}\n\n**Current state**: Service unchanged.\n\n**Desired state**: (rejected — see reason above)`,
    });
    await setTerminalRejected(cr.id, svc.id);
    return { state: "rejected", reason: result.reason };
  }

  await writeRevision({
    crId: cr.id,
    svcId: svc.id,
    step: "ai_validation_passed",
    serviceStatus: "aiReview",
    crStatus: "aiReviewing",
    aiSummary:
      "**Step**: AI validation passed\n\nCR is within all hard caps (CPU ≤ 4/pod, memory ≤ 8Gi/pod, replicas ≤ 20, trusted image source, no privileged/hostNetwork). Proceeding to artifact generation.",
  });

  await writeRevision({
    crId: cr.id,
    svcId: svc.id,
    step: "ai_artifacts_generated",
    serviceStatus: "aiReview",
    crStatus: "aiReviewing",
    aiSummary: `**Step**: AI artifacts generated\n\n${result.artifacts.summary}`,
    ciPipelineRef: result.artifacts.ciPipelineRef,
    dockerfileSnapshot: result.artifacts.dockerfile,
  });

  // Step 3 — open the PR
  const pr = await openFleetPr({
    tenant,
    service: svc,
    changeRequest: cr,
    artifacts: result.artifacts,
  });

  await writeRevision({
    crId: cr.id,
    svcId: svc.id,
    step: "pr_opened",
    serviceStatus: "platformReview",
    crStatus: "platformReviewing",
    aiSummary: `**Step**: PR opened\n\nFleet-managers PR awaiting platform-engineer review:\n${pr.url}`,
    cdManifestRef: pr.url,
  });

  await db
    .update(services)
    .set({ currentStatus: "platformReview", updatedAt: new Date() })
    .where(eq(services.id, svc.id));
  await db
    .update(changeRequests)
    .set({ status: "platformReviewing", updatedAt: new Date() })
    .where(eq(changeRequests.id, cr.id));

  return { state: "platformReview", prUrl: pr.url };
}

/** Fired by /api/webhooks/github on PR merge (and the manual admin endpoint). */
export async function markProvisioned(changeRequestId: string) {
  const [cr] = await db
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, changeRequestId))
    .limit(1);
  if (!cr) throw new Error("change request not found");

  await db
    .update(services)
    .set({ currentStatus: "working", updatedAt: new Date() })
    .where(eq(services.id, cr.serviceId));
  await db
    .update(changeRequests)
    .set({ status: "applied", updatedAt: new Date() })
    .where(eq(changeRequests.id, cr.id));

  await writeRevision({
    crId: cr.id,
    svcId: cr.serviceId,
    step: "pr_merged",
    serviceStatus: "working",
    crStatus: "applied",
    aiSummary:
      "**Step**: PR merged + ArgoCD synced\n\nPlatform engineer merged the fleet-managers PR. ArgoCD reconciled the new Application and reports Healthy.",
  });
}

async function writeRevision(args: {
  crId: string;
  svcId: string;
  step: Step;
  serviceStatus:
    | "na"
    | "aiReview"
    | "platformReview"
    | "provisioning"
    | "working"
    | "rejected";
  crStatus:
    | "submitted"
    | "aiReviewing"
    | "needsChanges"
    | "platformReviewing"
    | "approved"
    | "rejected"
    | "merged"
    | "applied";
  aiSummary?: string;
  ciPipelineRef?: string;
  dockerfileSnapshot?: string;
  cdManifestRef?: string;
}) {
  await db.insert(serviceRevisions).values({
    id: ulid(),
    changeRequestId: args.crId,
    serviceId: args.svcId,
    step: args.step,
    serviceStatus: args.serviceStatus,
    crStatus: args.crStatus,
    aiSummary: args.aiSummary,
    ciPipelineRef: args.ciPipelineRef,
    dockerfileSnapshot: args.dockerfileSnapshot,
    cdManifestRef: args.cdManifestRef,
  });
}

async function setTerminalRejected(crId: string, svcId: string) {
  await db
    .update(services)
    .set({ currentStatus: "rejected", updatedAt: new Date() })
    .where(eq(services.id, svcId));
  await db
    .update(changeRequests)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(changeRequests.id, crId));
}
