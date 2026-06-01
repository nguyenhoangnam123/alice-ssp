import { ulid } from "ulid";
import { db } from "@/lib/db";
import {
  services,
  changeRequests,
  serviceRevisions,
  tenants,
  type Service,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runPolicyGate } from "@/lib/policy/gate";
import { generateArtifacts } from "@/lib/ai/agent";
import { openFleetPr } from "@/lib/github/pr";

/**
 * In-process replacement for the Step Functions workflow described in the design.
 * Same state names, same transitions, same projection back onto Service.currentStatus.
 *
 * In MVP2 this is replaced by `StartExecution` against a real Step Functions state machine;
 * the call sites do not change.
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

  const gate = await runPolicyGate({ service: svc, tenant });
  if (!gate.ok) {
    await db
      .update(services)
      .set({ currentStatus: "rejected", updatedAt: new Date() })
      .where(eq(services.id, svc.id));
    await db
      .update(changeRequests)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(changeRequests.id, cr.id));
    await writeRevision({
      changeRequestId: cr.id,
      service: svc,
      serviceStatus: "rejected",
      crStatus: "rejected",
      aiSummary: `Policy gate failed: ${gate.violations.join("; ")}`,
    });
    return { state: "rejected", reason: gate.violations.join("; ") };
  }

  const artifacts = await generateArtifacts({ service: svc, tenant, changeRequest: cr });

  // --- 2. open PR → platformReview ---------------------------------------
  const pr = await openFleetPr({
    tenant,
    service: svc,
    changeRequest: cr,
    artifacts,
  });

  await db
    .update(services)
    .set({ currentStatus: "platformReview", updatedAt: new Date() })
    .where(eq(services.id, svc.id));
  await db
    .update(changeRequests)
    .set({ status: "platformReviewing", updatedAt: new Date() })
    .where(eq(changeRequests.id, cr.id));

  await writeRevision({
    changeRequestId: cr.id,
    service: svc,
    serviceStatus: "platformReview",
    crStatus: "platformReviewing",
    ciPipelineRef: artifacts.ciPipelineRef,
    dockerfileSnapshot: artifacts.dockerfile,
    cdManifestRef: pr.url,
    aiSummary: artifacts.summary,
  });

  return { state: "platformReview", prUrl: pr.url };
}

/**
 * Called by a webhook in MVP2. For now, an admin can trigger it manually from the UI
 * to simulate ArgoCD reporting "healthy".
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
    aiSummary: "ArgoCD reported sync healthy (simulated)",
  });
}

async function writeRevision(args: {
  changeRequestId: string;
  service: Service;
  serviceStatus: "na" | "aiReview" | "platformReview" | "provisioning" | "working" | "rejected";
  crStatus:
    | "submitted"
    | "aiReviewing"
    | "needsChanges"
    | "platformReviewing"
    | "approved"
    | "rejected"
    | "merged"
    | "applied";
  ciPipelineRef?: string;
  dockerfileSnapshot?: string;
  cdManifestRef?: string;
  aiSummary?: string;
}) {
  await db.insert(serviceRevisions).values({
    id: ulid(),
    changeRequestId: args.changeRequestId,
    serviceId: args.service.id,
    serviceStatus: args.serviceStatus,
    crStatus: args.crStatus,
    ciPipelineRef: args.ciPipelineRef,
    dockerfileSnapshot: args.dockerfileSnapshot,
    cdManifestRef: args.cdManifestRef,
    aiSummary: args.aiSummary,
  });
}
