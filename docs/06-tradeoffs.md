# 06 — Tradeoffs

Real architectural decisions made while building this slice, with reasoning. The spec
asks for one or two; here are the four that shaped the most code.

---

## 1. EKS vs App Runner / Lambda / ECS Fargate

**Decision:** EKS managed node group.

**Considered:**
- **App Runner** — service-per-app, zero-ops. Tempting, but it pins us to one model
  for compute and gives us no story for sidecars, NetworkPolicy, or fine-grained
  per-tenant isolation. Each new app is a new App Runner service — that fans out our
  IAM and budget surface area.
- **Lambda / ECS Fargate** — fine for stateless request/response. Most vibe-coded
  apps will be web UIs with sessions, background workers, and the occasional
  cron-like task; Lambda would force us to push complexity into Step Functions /
  SQS / EventBridge from day one.
- **EKS** — operator-heavy but **lets one chart fit every app**, gives us
  NetworkPolicy + ResourceQuota + PSA as native isolation primitives, and lets ALB
  + Gateway API + ExternalDNS handle the "live URL" story uniformly.

**Why EKS won:** the spec's central promise is "live URL my team uses." That promise
is most cleanly met by giving every app the same shape (Deployment + Service +
HTTPRoute) and treating per-tenant differences as data, not infrastructure. App
Runner makes the easy case easier but the hard case (a tenant that needs a worker
+ a web + a scheduled job) impossible.

**What we pay for it:** an idle EKS bill (~$70/mo control plane + $50/mo NAT) on a
quiet account, and the operator burden of keeping addons up to date. For MVP1 with
≤5 apps it's an over-spend; the trade flips at ~20 apps when per-app App Runner
costs catch up.

---

## 2. In-process orchestrator vs Step Functions / SQS

**Decision:** in-process, fire-and-forget `processChangeRequest(crId)` inside the
Next.js portal.

**Considered:**
- **Step Functions** — gives durable workflow, retries, observability for free.
  Right answer for MVP2.
- **SQS + worker** — durable, but introduces a second deploy unit and forces us to
  build the worker observability ourselves.
- **In-process** — one process, one log stream, one `status_history` JSONB column
  that's our audit trail.

**Why in-process won for MVP1:** the workflow is short (≤30s of work) and the
failure modes are bounded — Bedrock throttle, GitHub API failure, DB write. Each
of those has its own logged error and an idempotent retry path (re-submitting a
CR with the same description produces the same artifacts). Step Functions buys us
durability we don't yet need.

**What we pay for it:** the portal Deployment is single-replica. Adding a second
replica would race on `service.currentStatus` writes and double-fire the prober.
The prober opt-in env (`SSP_PORTAL_PROBER=true`) is a band-aid; MVP2 moves the
prober to a CronJob and the orchestrator to Step Functions, which together unblock
HA.

---

## 3. Public ALB + WAF vs internal-only ALB

**Decision:** public ALB for the eval, with WAFv2 in front. **This is a deliberate
deviation from the spec** (the spec says external traffic is out of scope).

**Why:** the eval reviewer needs to click a real URL and see a real cert. Putting
the cluster on a private NLB + VPN would have added 1-2h to the build for an audience
that's evaluating architecture, not network paths. The WAF + the Cognito auth
boundary + per-route HMAC (for webhooks) give us the security we'd need internally
anyway.

**For a real Alice deployment**: the ALB binding flips to internal-only and Route53
zone moves to a private hosted zone. No code change in the portal or the chart —
only the LBC's `LoadBalancerConfiguration` annotation flips from `scheme=internet-facing`
to `scheme=internal`.

---

## 4. 1-level FQDN convention vs per-tenant subdomain

**Decision:** every service gets a single-level subdomain under
`ssp.mightybee.dev` (e.g. `api.ssp.mightybee.dev`), **not** under a per-tenant
parent (e.g. `api.alice.ssp.mightybee.dev`).

**Considered:**
- **Two-level (`<sub>.<tenant>.ssp.mightybee.dev`)** — better tenant-visibility in
  URLs; what we tried first.
- **One-level (`<sub>.ssp.mightybee.dev`)** — flatter URL, single cert.

**Why one-level won:** an ACM `*.ssp.mightybee.dev` wildcard covers exactly **one
level**. The two-level approach broke TLS handshake on every tenant route — the
prober correctly reported every tenant service as unhealthy because the cert
subject didn't match.

We could have issued a cert per tenant zone (`*.alice.ssp.mightybee.dev`,
`*.bob.ssp.mightybee.dev`, …) but that ties cert lifecycle to tenant lifecycle —
a single failure at `terraform apply` for tenant X breaks every cert renewal in
that account. One wildcard with global subdomain uniqueness keeps the cert plane
flat.

**What we pay for it:** subdomain name collisions are now a platform-wide constraint
("alice can't have `api` if bob already does"). The policy gate enforces uniqueness
within a tenant; cross-tenant uniqueness is a platform-team gatekeep — same as a
domain registration in any company.

**Receipt:** PR #16 against api-service is the live record of this re-route, done
**via a CR** rather than a Terraform apply — proving the platform itself is
self-modifying.
