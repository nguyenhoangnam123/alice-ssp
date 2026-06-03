// Layer 4 — deterministic re-validation of the AI's generated artifacts
// (deliverable1-03 guardrail).
//
// Even if a sophisticated prompt-injection talked the model into generating
// privileged YAML, the YAML still has to pass this parser before the PR opens.
// The check is on the values.yaml (which the helm chart will render into
// the Deployment) and the ArgoCD Application manifest. We do NOT trust the
// AI's prose; we parse and assert.
//
// On violation: orchestrator transitions CR to ai_validation_rejected, emits
// a guarded_action, no PR is opened.

import { parse as parseYaml } from "yaml";
import type { Artifacts } from "@/lib/ai/agent";

export type OutputCheck = { ok: true } | { ok: false; violations: string[] };

/**
 * Forbidden settings — present even one of these in the rendered Pod spec
 * and the CR is rejected. The list mirrors the system-prompt allowlist; this
 * is the **enforcement** of those rules, the prompt is just the **request**.
 */
export function validateGeneratedArtifacts(artifacts: Artifacts): OutputCheck {
  const violations: string[] = [];

  // --- values.yaml --------------------------------------------------------
  let values: unknown;
  try {
    values = parseYaml(artifacts.helmValues);
  } catch (err) {
    return {
      ok: false,
      violations: [
        `generated values.yaml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (values && typeof values === "object") {
    const v = values as Record<string, any>;
    const sc = v.securityContext ?? {};
    const psc = v.podSecurityContext ?? {};
    if (sc.privileged === true || psc.privileged === true) {
      violations.push("values.yaml sets securityContext.privileged=true");
    }
    if (sc.allowPrivilegeEscalation === true) {
      violations.push("values.yaml sets securityContext.allowPrivilegeEscalation=true");
    }
    if (sc.runAsUser === 0 || psc.runAsUser === 0) {
      violations.push("values.yaml sets runAsUser=0 (root) — must be ≥10000");
    }
    if (v.hostNetwork === true || (v.pod && v.pod.hostNetwork === true)) {
      violations.push("values.yaml sets hostNetwork=true");
    }
    if (v.hostPID === true || (v.pod && v.pod.hostPID === true)) {
      violations.push("values.yaml sets hostPID=true");
    }
    if (v.hostIPC === true || (v.pod && v.pod.hostIPC === true)) {
      violations.push("values.yaml sets hostIPC=true");
    }
    // hostPath volumes — search through volume blocks if present.
    const volumes = Array.isArray(v.volumes) ? v.volumes : [];
    for (const vol of volumes) {
      if (vol && typeof vol === "object" && vol.hostPath) {
        violations.push(
          `values.yaml mounts hostPath ${JSON.stringify(vol.hostPath)}`,
        );
      }
    }
    // Replica cap defence-in-depth (system prompt also rejects this, but layer 4
    // catches it if the model slipped through).
    if (typeof v.replicaCount === "number" && v.replicaCount > 20) {
      violations.push(`values.yaml replicaCount=${v.replicaCount} exceeds 20-replica cap`);
    }
    // CPU / memory caps — only check if they're explicit numerics; the helm
    // chart's defaults are safe.
    const cpu = v.resources?.requests?.cpu ?? v.resources?.limits?.cpu;
    if (typeof cpu === "string" && /^(\d+)$/.test(cpu) && Number(cpu) > 4) {
      violations.push(`values.yaml CPU=${cpu} exceeds 4-core cap`);
    }
  }

  // --- argocd application -------------------------------------------------
  let app: unknown;
  try {
    app = parseYaml(artifacts.argocdApp);
  } catch {
    violations.push("generated ArgoCD Application is not valid YAML");
    app = null;
  }
  if (app && typeof app === "object") {
    const a = app as Record<string, any>;
    const meta = a.metadata ?? {};
    if (meta.namespace !== "argocd") {
      violations.push(
        `ArgoCD Application metadata.namespace=${meta.namespace ?? "(unset)"} — must be 'argocd' so app-of-apps picks it up`,
      );
    }
    const fins: string[] = Array.isArray(meta.finalizers) ? meta.finalizers : [];
    if (!fins.includes("resources-finalizer.argocd.argoproj.io")) {
      violations.push(
        "ArgoCD Application missing finalizer 'resources-finalizer.argocd.argoproj.io' — cascade-delete won't clean up children on rename/removal",
      );
    }
    const dest = a.spec?.destination ?? {};
    if (
      typeof dest.namespace === "string" &&
      !/^tenant-[a-z0-9-]+$/.test(dest.namespace) &&
      dest.namespace !== "argocd"
    ) {
      violations.push(
        `ArgoCD Application destination.namespace=${dest.namespace} — must be 'tenant-<name>'`,
      );
    }
  }

  return violations.length === 0
    ? { ok: true }
    : { ok: false, violations };
}
