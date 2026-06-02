import { ulid } from "ulid";
import { db } from "@/lib/db";
import {
  services,
  changeRequests,
  serviceRevisions,
  tenants,
  type Service,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { runPolicyGate } from "@/lib/policy/gate";
import { generateArtifacts, type AgentResult } from "@/lib/ai/agent";
import { openFleetPr } from "@/lib/github/pr";

/**
 * In-process replacement for the Step Functions workflow.
 *
 *   submitted → aiReview → (rejected | platformReview → provisioning → working)
 *
 * The AI agent can REJECT the CR. In that case the workflow short-circuits: no PR, no
 * provisioning, status becomes rejected with the reason recorded in the revision.
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

  // --- 1. aiReview --------------------------------------------------------
  await db
    .update(services)
    .set({ currentStatus: "aiReview", updatedAt: new Date() })
    .where(eq(services.id, svc.id));
  await db
    .update(changeRequests)
    .set({ status: "aiReviewing", updatedAt: new Date() })
    .where(eq(changeRequests.id, cr.id));

  // Deterministic gate first (cheap fast checks). Catches description length, https git url,
  // unique subdomain, soft-deleted tenant — before we burn LLM tokens.
  const gate = await runPolicyGate({ service: svc, tenant });
  if (!gate.ok) {
    return reject(cr.id, svc, gate.violations.join("; "));
  }

  // Find the previous revision (if any) to describe "current state" to the AI.
  const [previous] = await db
    .select()
    .from(serviceRevisions)
    .where(eq(serviceRevisions.serviceId, svc.id))
    .orderBy(desc(serviceRevisions.createdAt))
    .limit(1);

  const currentStateSummary = previous
    ? `Most recent revision was at ${previous.createdAt.toISOString()}, service_status=${previous.serviceStatus}, cr_status=${previous.crStatus}.\nAI summary at that revision:\n${previous.aiSummary ?? "(no summary)"}`
    : "(new service — no previous revision)";

  // LLM call.
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
    return reject(cr.id, svc, `AI agent error: ${msg}`);
  }

  if (result.kind === "rejected") {
    return reject(cr.id, svc, result.reason);
  }

  // --- 2. open PR → platformReview ---------------------------------------
  const pr = await openFleetPr({
    tenant,
    service: svc,
    changeRequest: cr,
    artifacts: result.artifacts,
  });

  await db
    .update(services)
    .set({ currentStatus: "platformReview", updatedAt: new Date() })
    .where(eq(services.id, svc.id));
  await db
    .update(changeRequests)
    .set({ status: "platformReviewing", updatedAt: new Date() })
    .where(eq(changeRequests.id, cr.id));

  await db.insert(serviceRevisions).values({
    id: ulid(),
    changeRequestId: cr.id,
    serviceId: svc.id,
    serviceStatus: "platformReview",
    crStatus: "platformReviewing",
    ciPipelineRef: result.artifacts.ciPipelineRef,
    dockerfileSnapshot: result.artifacts.dockerfile,
    cdManifestRef: pr.url,
    aiSummary: result.artifacts.summary,
  });

  return { state: "platformReview", prUrl: pr.url };
}

/**
 * Called by an ArgoCD webhook in MVP2; for now an admin can flip a CR by hitting the
 * mark-provisioned API to simulate "platform engineer merged + ArgoCD reconciled healthy".
 */
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

  await db.insert(serviceRevisions).values({
    id: ulid(),
    changeRequestId: cr.id,
    serviceId: cr.serviceId,
    serviceStatus: "working",
    crStatus: "applied",
    aiSummary: "**Current state**: Provisioning complete.\n\n**Desired state**: (n/a — terminal state)\n\n**Summary**: ArgoCD reported sync healthy.",
  });
}

async function reject(crId: string, svc: Service, reason: string) {
  await db
    .update(services)
    .set({ currentStatus: "rejected", updatedAt: new Date() })
    .where(eq(services.id, svc.id));
  await db
    .update(changeRequests)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(eq(changeRequests.id, crId));
  await db.insert(serviceRevisions).values({
    id: ulid(),
    changeRequestId: crId,
    serviceId: svc.id,
    serviceStatus: "rejected",
    crStatus: "rejected",
    aiSummary: `**Rejected by AI**: ${reason}\n\n**Current state**: Service unchanged.\n\n**Desired state**: (rejected — see reason above)`,
  });
  return { state: "rejected", reason };
}
