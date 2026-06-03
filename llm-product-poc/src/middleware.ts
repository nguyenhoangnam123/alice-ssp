// Host-scoped route gating. The portal Deployment serves both
// portal.ssp.mightybee.dev (full admin UI) and chat.ssp.mightybee.dev
// (chat-only experience) via the helm chart's route.additionalHosts.
// Without this middleware, every path on the portal is reachable on the
// chat host — dashboard, tenants, services, internal APIs. That's a real
// authorization leak: a chat user who knows the URL pattern can pivot to
// the admin surface even without admin permissions, because the chat
// host is auth'd via Cognito (which the portal admin path doesn't yet
// gate explicitly — it uses stub auth in this build).
//
// Allowed on chat.ssp.mightybee.dev:
//   - /                        → 307 redirect to /chat
//   - /chat/*                  → chat UI pages
//   - /api/chat/*              → chat backend (sign-in, send message)
//   - /api/auth/*              → Cognito callback URL
//   - /_next/*, /favicon.ico   → Next.js assets
//
// Everything else on chat.* returns 404. The full admin portal at
// portal.ssp.mightybee.dev is unaffected.
//
// MVP1 compromise. The real fix is the Ring 3 migration that splits chat
// out as its own tenant deployment (documented in deliverable1-04).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isChatHost(host: string): boolean {
  // Strip port for safety; some load balancers append :443.
  const bare = host.split(":")[0].toLowerCase();
  return bare === "chat.ssp.mightybee.dev" || bare.startsWith("chat.");
}

function isAllowedOnChatHost(pathname: string): boolean {
  return (
    pathname.startsWith("/chat") ||
    pathname.startsWith("/api/chat") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  );
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  if (!isChatHost(host)) {
    // portal.* — no scoping; let everything through.
    return NextResponse.next();
  }

  // chat.*  — root redirects to /chat (which itself redirects to
  // /chat/login if no Cognito session cookie is set).
  if (pathname === "/" || pathname === "") {
    const url = req.nextUrl.clone();
    url.pathname = "/chat";
    return NextResponse.redirect(url, 307);
  }

  if (isAllowedOnChatHost(pathname)) {
    return NextResponse.next();
  }

  // Anything else on the chat host: 404. No admin pivots, no
  // /dashboard, no /api/internal/*, no /api/services/*.
  return new NextResponse("Not found", {
    status: 404,
    headers: { "content-type": "text/plain" },
  });
}

// Matcher excludes static assets so Next.js can short-circuit those without
// invoking the middleware. The middleware itself still handles non-static
// requests on chat.*.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
