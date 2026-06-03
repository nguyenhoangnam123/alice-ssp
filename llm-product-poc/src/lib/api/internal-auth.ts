// Internal HTTP API auth — used by the MCP server running inside tenant pods to
// reach the portal's budget endpoints. The token lives in Secrets Manager and
// is mounted to BOTH the portal and every tenant namespace via ESO. Symmetric
// shared secret is acceptable here because:
//   - traffic is cluster-internal (NetworkPolicy allows tenant→portal only on
//     the portal's HTTPRoute)
//   - leak surface is the same as the tenant's other secrets
//   - rotation is a portal-side env update + an ESO refresh
//
// MVP1 only. Ring 2 swaps this for short-lived JWTs signed by the portal,
// scoped to a specific tenant_id claim so a leaked tenant token can't be
// used against another tenant's data.

import { NextRequest, NextResponse } from "next/server";

export function checkInternalAuth(req: NextRequest): NextResponse | null {
  const expected = process.env.SSP_INTERNAL_TOKEN;
  if (!expected || expected.length < 16) {
    // Fail closed if the env isn't set — better to break the endpoint than
    // accept anonymous internal traffic.
    return NextResponse.json(
      { error: "internal_api_unconfigured" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  // Constant-time compare to avoid timing side-channel — tiny but cheap.
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
