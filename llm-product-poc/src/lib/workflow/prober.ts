import { db } from "@/lib/db";
import { serviceRevisions, services } from "@/lib/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";

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

  if (process.env.PROBER_DISABLED === "true") {
    console.log("prober disabled via PROBER_DISABLED env");
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
  const rows = await db
    .select({
      id: serviceRevisions.id,
      serviceId: serviceRevisions.serviceId,
      routeHost: serviceRevisions.routeHost,
    })
    .from(serviceRevisions)
    .where(
      and(
        eq(serviceRevisions.existenceStatus, "created"),
        isNotNull(serviceRevisions.routeHost),
      ),
    );

  if (rows.length === 0) return;
  console.log(`prober: probing ${rows.length} revisions`);
  await Promise.all(rows.map(probeOne));
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
