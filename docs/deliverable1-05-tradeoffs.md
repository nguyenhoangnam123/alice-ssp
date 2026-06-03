# Deliverable 1 — 05 · Tradeoffs

The spec asks for one or two real decisions. Four shaped the most code; each
has a "what we pay for it" line because trade-offs without costs are
marketing.

## 1. EKS vs App Runner / Lambda / ECS Fargate

**Decision:** EKS managed node group.

**Considered:**
- **App Runner** — service-per-app, zero-ops. Tempting, but pins us to one
  compute model and gives no story for sidecars, NetworkPolicy, or fine-grained
  isolation. Each new app fans out our IAM + budget surface area.
- **Lambda / ECS Fargate** — fine for stateless request/response. Most
  vibe-coded apps will be web UIs with sessions, background workers, occasional
  cron. Lambda forces complexity into Step Functions / SQS / EventBridge from
  day one.
- **EKS** — operator-heavy but **one chart fits every app**. Native primitives
  for isolation. ALB + Gateway API + ExternalDNS handles "live URL" uniformly.

**Why EKS won:** the spec's central promise is "live URL my team uses." That
promise is most cleanly met by giving every app the same shape (Deployment +
Service + HTTPRoute) and treating per-tenant differences as **data, not
infrastructure**. App Runner makes the easy case easier but the hard case (a
tenant that needs worker + web + scheduled job) impossible.

**What we pay for it:** idle bill ~$70/mo control plane + ~$50/mo NAT. For
MVP1 with ≤5 apps it's an over-spend; the trade flips at ~20 apps when
per-app App Runner costs catch up.

## 2. In-process orchestrator vs Step Functions / SQS

**Decision:** in-process, fire-and-forget `processChangeRequest(crId)` inside
the Next.js portal.

**Considered:**
- **Step Functions** — durable workflow, retries, observability for free.
  Right answer for MVP2.
- **SQS + worker** — durable, but second deploy unit + we'd have to build
  the worker observability ourselves.
- **In-process** — one process, one log stream, one `status_history` JSONB
  column = audit trail.

**Why in-process won for MVP1:** the workflow is short (≤30s of work) and
failure modes are bounded — Bedrock throttle, GitHub API failure, DB write.
Each has its own logged error and an idempotent retry path (re-submitting a
CR with the same description produces the same artifacts). Step Functions
buys durability we don't yet need.

**What we pay for it:** portal Deployment is **single-replica**. Adding a
second would race on `service.currentStatus` writes and double-fire the
prober. The prober opt-in env (`SSP_PORTAL_PROBER=true`) is a band-aid; MVP2
moves prober to a CronJob and orchestrator to Step Functions, which together
unblock HA.

## 3. Public ALB + WAF vs internal-only ALB

**Decision:** public ALB for the eval, with WAFv2 in front. **This is a
deliberate deviation from the spec** (which says external traffic is out of
scope).

**Why:** the eval reviewer needs to click a real URL and see a real cert.
Putting the cluster on a private NLB + VPN would have added 1-2h to the build
for an audience evaluating architecture, not network paths. The WAF + Cognito
auth boundary + per-route HMAC (for webhooks) give us the security we'd need
internally anyway.

**For a real Alice deployment**: the ALB binding flips to internal-only,
Route53 zone moves to a private hosted zone. **No code change** in the portal
or the chart — only the LBC's `LoadBalancerConfiguration` annotation flips
from `scheme=internet-facing` to `scheme=internal`. The Gateway picks up the
new config; clients move from public DNS to Route53 private zone.

**What we pay for it:** a reviewer might think we ignored the constraint. We
didn't — we made the path back to internal-only one Terraform variable.

## 4. One-level FQDN vs per-tenant subdomain

**Decision:** every service gets a single-level subdomain under
`ssp.mightybee.dev` (e.g. `api.ssp.mightybee.dev`), **not** under a per-tenant
parent (e.g. `api.alice.ssp.mightybee.dev`).

**Considered:**
- **Two-level (`<sub>.<tenant>.ssp.mightybee.dev`)** — better tenant-visibility
  in URLs; what we tried first.
- **One-level (`<sub>.ssp.mightybee.dev`)** — flatter URL, single cert.

**Why one-level won:** an ACM `*.ssp.mightybee.dev` wildcard covers exactly
**one level**. Two-level broke TLS handshake on every tenant route — the
prober correctly reported every tenant service as unhealthy because the cert
subject didn't match.

We could have issued a cert per tenant zone (`*.alice.ssp.mightybee.dev`, …)
but that ties cert lifecycle to tenant lifecycle — a single `terraform apply`
failure for tenant X breaks every cert renewal in that account. One wildcard
with global subdomain uniqueness keeps the cert plane flat.

**What we pay for it:** subdomain name collisions are now a platform-wide
constraint ("alice can't have `api` if bob already does"). The policy gate
enforces uniqueness within a tenant; cross-tenant uniqueness is a platform-team
gatekeep — same as a domain registration in any company.

**Receipt:** PR [#16](https://github.com/nguyenhoangnam123/alice-ssp/pull/16)
against api-service is the live record of this re-route, done **via a CR**
rather than a Terraform apply — proving the platform itself is self-modifying.
