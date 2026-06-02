import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { serviceRevisions } from "@/lib/db/schema";
import { markProvisioned } from "@/lib/workflow/orchestrator";

/**
 * GitHub webhook receiver. Closes the workflow loop:
 *
 *   PR merged on alice-ssp → GitHub POSTs to this endpoint → we find the
 *   ServiceRevision row whose cd_manifest_ref matches the PR URL → call
 *   markProvisioned() so the CR advances to `applied` and Service to `working`.
 *
 * MVP1 collapses "merged → provisioning → working" into one step. MVP2 should
 * split: webhook sets `merged`, then a separate ArgoCD notification (sync OK)
 * sets `applied`/`working`.
 *
 * Configure in GitHub: Settings → Webhooks → Add webhook
 *   Payload URL    https://portal.ssp.mightybee.dev/api/webhooks/github
 *   Content type   application/json
 *   Secret         (the SSP_GITHUB_WEBHOOK_SECRET env var on the pod)
 *   Events         "Let me select" → Pull requests
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SSP_GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "webhook secret not configured" },
      { status: 503 },
    );
  }

  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const event = req.headers.get("x-github-event") ?? "";
  const body = await req.text();

  // Verify HMAC SHA256 signature — every byte of the raw body, keyed by the shared secret.
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex");
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Quiet acknowledgements for events we don't care about (ping etc.).
  if (event === "ping") {
    return NextResponse.json({ ok: true, ack: "pong" });
  }
  if (event !== "pull_request") {
    return NextResponse.json({ ok: true, skipped: `event=${event}` });
  }

  type PrPayload = {
    action: string;
    pull_request: { merged: boolean; html_url: string; number: number };
  };
  const payload = JSON.parse(body) as PrPayload;

  if (payload.action !== "closed" || !payload.pull_request.merged) {
    return NextResponse.json({
      ok: true,
      skipped: `action=${payload.action} merged=${payload.pull_request.merged}`,
    });
  }

  // Find the CR whose latest revision tagged this PR URL.
  const [revision] = await db
    .select()
    .from(serviceRevisions)
    .where(eq(serviceRevisions.cdManifestRef, payload.pull_request.html_url))
    .limit(1);

  if (!revision) {
    return NextResponse.json({
      ok: true,
      skipped: "no matching ServiceRevision for this PR URL",
      url: payload.pull_request.html_url,
    });
  }

  await markProvisioned(revision.changeRequestId);

  console.log(
    `github-webhook merged PR ${payload.pull_request.number} → markProvisioned(${revision.changeRequestId})`,
  );

  return NextResponse.json({
    ok: true,
    changeRequestId: revision.changeRequestId,
    prNumber: payload.pull_request.number,
  });
}
