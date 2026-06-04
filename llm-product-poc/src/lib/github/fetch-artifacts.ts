import { Octokit } from "@octokit/rest";
import type { Service, Tenant } from "@/lib/db/schema";

/**
 * Snapshot of the four files that already live in the fleet repo for a given
 * service. Fed back to the AI so the next CR is a DIFF against this, not a
 * regenerate-from-scratch.
 *
 * Each field is null when the file doesn't exist yet (new service — first CR).
 */
export type FleetArtifactsSnapshot = {
  helmValues: string | null;
  dockerfile: string | null;
  ciWorkflow: string | null;
  argocdApp: string | null;
};

/**
 * Read the four current artifacts from the fleet repo at the base branch
 * HEAD. The orchestrator passes the result into the AI prompt so the AI can
 * MERGE the CR's requested changes into the existing config (instead of
 * regenerating from scratch and dropping IRSA / envFrom / externalSecrets
 * blocks that the CR never asked to touch).
 *
 * Real bug this guards against: PR #22 — CR asked "bump memory", AI emitted
 * a full values.yaml that wiped image / port / serviceAccount.annotations /
 * env / envFrom / externalSecrets because none of those were in the payload.
 * With the current values.yaml in context, the AI now has the prior config
 * to preserve verbatim.
 *
 * Without GITHUB_TOKEN: returns all-null (the AI falls back to its current
 * "generate from CR alone" behaviour — fine for local mock runs).
 */
export async function fetchCurrentArtifacts(args: {
  tenant: Tenant;
  service: Service;
}): Promise<FleetArtifactsSnapshot> {
  const token = process.env.GITHUB_TOKEN ?? "";
  const empty: FleetArtifactsSnapshot = {
    helmValues: null,
    dockerfile: null,
    ciWorkflow: null,
    argocdApp: null,
  };
  if (!token || token.startsWith("ghp_REPLACE")) return empty;

  const owner = process.env.FLEET_REPO_OWNER ?? "nguyenhoangnam123";
  const repo = process.env.FLEET_REPO_NAME ?? "alice-ssp";
  const baseBranch = process.env.FLEET_REPO_BASE_BRANCH ?? "main";

  const gh = new Octokit({ auth: token });
  const base = `fleet-managers/tenants/${args.tenant.domain}/apps/${args.service.name}`;

  // Each lookup may 404 (file not in repo yet). Run in parallel; treat any
  // non-200 as "file does not exist" rather than failing the whole CR — the
  // AI can still generate a first-cut without prior context.
  const [v, d, c, a] = await Promise.all([
    readOrNull(gh, owner, repo, `${base}/values.yaml`, baseBranch),
    readOrNull(gh, owner, repo, `${base}/Dockerfile`, baseBranch),
    readOrNull(gh, owner, repo, `${base}/build.yml`, baseBranch),
    readOrNull(gh, owner, repo, `${base}/application.yaml`, baseBranch),
  ]);

  return {
    helmValues: v,
    dockerfile: d,
    ciWorkflow: c,
    argocdApp: a,
  };
}

async function readOrNull(
  gh: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const res = await gh.repos.getContent({ owner, repo, path, ref });
    // Single-file response has a base64 .content; directory responses are an
    // array and we don't expect those for these paths.
    const data = res.data as { content?: string; encoding?: string };
    if (!data.content || data.encoding !== "base64") return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 404) return null;
    // Any non-404 (rate limit, auth) — log and treat as missing rather than
    // failing the CR. The output validator + reviewer still catch unsafe
    // regenerations downstream.
    console.warn(`[fetchCurrentArtifacts] ${path}: ${String(err)}`);
    return null;
  }
}
