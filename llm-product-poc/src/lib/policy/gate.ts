import type { Service, Tenant } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { scanInjection, scanPii } from "./scanners";

/**
 * Deterministic policy gate — the OPA / Conftest equivalent for MVP1.
 * Runs *before* the AI agent is invoked, so generative output never bypasses
 * a hard rule.
 *
 * In MVP2, this is replaced by `conftest test` against Rego policies in the fleet repo.
 * Adding a rule here should be possible without retraining or prompt changes.
 */
export type GateResult =
  | { ok: true }
  | { ok: false; violations: string[] };

export async function runPolicyGate(args: {
  service: Service;
  tenant: Tenant;
}): Promise<GateResult> {
  const violations: string[] = [];

  // 1. Description is mandatory and non-trivial.
  if (!args.service.description || args.service.description.trim().length < 20) {
    violations.push(
      "description must be at least 20 characters (it is the AI prompt input)",
    );
  } else {
    // 1a. Prompt-injection markers (layer 1 of deliverable1-03). Catches the
    // obvious 'ignore previous instructions', system-role impersonation, and
    // fenced-block takeover patterns. Sophisticated attacks need layers 2-4.
    for (const f of scanInjection(args.service.description)) {
      violations.push(`prompt-injection: ${f.message} [${f.rule}]`);
    }

    // 1b. PII regex pre-filter (PII layer A). Cheap; rejects the obvious so
    // we never POST raw PII to Bedrock or store it in the DB. We surface only
    // the redacted form so this rejection record is itself PII-clean.
    for (const f of scanPii(args.service.description)) {
      violations.push(`PII detected: ${f.message} [${f.rule}]`);
    }
  }

  // 2. git_repo must look like a valid https URL.
  try {
    const url = new URL(args.service.gitRepo);
    if (url.protocol !== "https:") {
      violations.push("git_repo must use https://");
    }
  } catch {
    violations.push("git_repo is not a valid URL");
  }

  // 3. Subdomain (if present) must be exactly one DNS label off the SSP zone — either
  // a bare label ("api") which is concatenated to ".ssp.mightybee.dev" by the
  // orchestrator, or a full FQDN that itself is one level deep ("api.ssp.mightybee.dev").
  // Two-level subdomains are forbidden because the wildcard ACM cert is *.ssp.mightybee.dev
  // and does NOT cover *.<anything>.ssp.mightybee.dev.
  if (args.service.subdomain) {
    const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    const ONE_LEVEL_FQDN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.ssp\.mightybee\.dev$/;
    if (!LABEL.test(args.service.subdomain) && !ONE_LEVEL_FQDN.test(args.service.subdomain)) {
      violations.push(
        `subdomain "${args.service.subdomain}" must be a single DNS label ("api") or a one-level FQDN under ssp.mightybee.dev ("api.ssp.mightybee.dev") — deeper subdomains aren't covered by the wildcard TLS cert`,
      );
    }

    // Unique within tenant.
    const rows = await db
      .select({ id: services.id })
      .from(services)
      .where(
        and(
          eq(services.tenantId, args.tenant.id),
          eq(services.subdomain, args.service.subdomain),
          ne(services.id, args.service.id),
        ),
      );
    if (rows.length > 0) {
      violations.push(
        `subdomain ${args.service.subdomain} already in use within tenant`,
      );
    }
  }

  // 4. Tenant must not be soft-deleted.
  if (args.tenant.deletedAt) {
    violations.push("tenant is deleted");
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
