import type { Service, Tenant } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { services } from "@/lib/db/schema";
import { and, eq, ne } from "drizzle-orm";

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

  // 3. Subdomain (if present) is unique within tenant.
  if (args.service.subdomain) {
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
