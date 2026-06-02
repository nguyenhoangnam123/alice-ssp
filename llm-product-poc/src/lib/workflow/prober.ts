import { db } from "@/lib/db";
import { serviceRevisions, services } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Periodic readiness prober.
 *
 * Every PROBE_INTERVAL_MS, for each revision marked existence_status='created' that
 * has a route_host: HTTP GET https://<host>/ and update health_status + last_probed_at.
 * Also mirrors onto service.currentStatus so listing pages don't need to JOIN.
 *
 * Single-replica deployment: setInterval at module load is fine. MVP2 should move this
 * to a CronJob / Argo Events so it survives portal restarts and scales.
 */
const PROBE_INTERVAL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

let started = false;

export function startProber() {
  if (started) return;
  started = true;

  // Opt-IN. The same image runs in tenant pods (as a placeholder until tenants ship
  // their own apps), and we don't want every tenant pod spinning up a duplicate
  // prober trying to reach a DATABASE_URL it doesn't have. Only the portal
  // deployment sets SSP_PORTAL_PROBER=true in its values.yaml.
  if (process.env.SSP_PORTAL_PROBER !== "true") {
    console.log("prober: skipping (SSP_PORTAL_PROBER!=true)");
    return;
  }

  console.log(`prober: starting (interval=${PROBE_INTERVAL_MS}ms)`);
  const tick = async () => {
    try {
      await runOnce();
    } catch (err) {
      console.error("prober tick failed", err);
    }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, PROBE_INTERVAL_MS);
}

async function runOnce() {
  // Only probe the LATEST revision per service. Older revisions are historical: their
  // route_host may have been replaced (e.g. hot-fix CR changed the FQDN), so keeping the
  // probe running against a dead host would update the same row to 'unhealthy' forever
  // AND clobber service.currentStatus via the mirror. The latest revision is the one that
  // represents current reality.
  const rows = await db.execute<{
    id: string;
    service_id: string;
    route_host: string;
  }>(sql`
    SELECT DISTINCT ON (service_id) id, service_id, route_host
    FROM service_revisions
    WHERE existence_status = 'created' AND route_host IS NOT NULL
    ORDER BY service_id, created_at DESC
  `);

  if (rows.length === 0) return;
  console.log(`prober: probing ${rows.length} revisions (latest per service)`);
  await Promise.all(
    rows.map((r) =>
      probeOne({ id: r.id, serviceId: r.service_id, routeHost: r.route_host }),
    ),
  );
}

/**
 * Probe a single revision now, instead of waiting up to PROBE_INTERVAL_MS for the next
 * scheduled tick. Called by the orchestrator the moment a revision flips to
 * existence='created' so the UI shows a real health badge within seconds.
 *
 * Caller is expected to await OR fire-and-forget; we catch internally so a
 * fire-and-forget invocation can't crash the orchestrator.
 */
export async function probeRevisionNow(rev: {
  id: string;
  serviceId: string;
  routeHost: string | null;
}) {
  try {
    await probeOne(rev);
  } catch (err) {
    console.error(`probeRevisionNow(${rev.id}) failed`, err);
  }
}

async function probeOne(row: {
  id: string;
  serviceId: string;
  routeHost: string | null;
}) {
  if (!row.routeHost) return;
  const url = `https://${row.routeHost}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  let status: "healthy" | "unhealthy" = "unhealthy";
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "ssp-portal-prober/1.0" },
    });
    if (res.status >= 200 && res.status < 400) status = "healthy";
  } catch {
    status = "unhealthy";
  } finally {
    clearTimeout(timer);
  }

  await db
    .update(serviceRevisions)
    .set({ healthStatus: status, lastProbedAt: new Date() })
    .where(eq(serviceRevisions.id, row.id));

  // Mirror to service: healthy → working, unhealthy → provisioning (closest existing
  // enum that conveys "trying but not yet OK"). Latest revision per service drives
  // this; since we update on every probe, the value tracks reality within one interval.
  const svcStatus = status === "healthy" ? "working" : "provisioning";
  await db
    .update(services)
    .set({ currentStatus: svcStatus, updatedAt: new Date() })
    .where(eq(services.id, row.serviceId));
}
