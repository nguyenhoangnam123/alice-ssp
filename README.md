# SSP — Self-Service Portal

Closes the gap between vibe-coding product engineers and platform engineers. A
product engineer describes a service in a paragraph; Bedrock Claude Opus 4.6
validates, rejects or generates Dockerfile / CI workflow / Helm values /
ArgoCD Application; a real PR opens against this repo for a human to merge;
ArgoCD reconciles into EKS.

| Live | URL |
| --- | --- |
| Portal | https://portal.ssp.mightybee.dev |
| Example deployed service | https://api.ssp.mightybee.dev (HTTP 200, nginx) |
| GitOps repo | https://github.com/nguyenhoangnam123/alice-ssp |
| Most-recent AI-generated PR | https://github.com/nguyenhoangnam123/alice-ssp/pull/17 |

## How to run / explore

The platform is **already running** in the user's AWS account (`195748744911`,
eu-west-1). For a reviewer who wants to look at it, the high-signal artifacts
are:

```sh
# 1. Open the portal in a browser
open https://portal.ssp.mightybee.dev

# 2. See the most recent AI-generated PR
open https://github.com/nguyenhoangnam123/alice-ssp/pull/17

# 3. Run the observability MCP server's toy app locally (no AWS needed)
cd mcp-server
npm install
npm run toy
# → JSON events on stderr: span, llm_call (with cost), guarded_action
```

To onboard a service end-to-end, see
[docs/05-onboarding-walkthrough.md](./docs/05-onboarding-walkthrough.md) —
click-by-click using the live portal.

## Read first (mapped to assessment spec)

The spec asks for eight things in the design doc. Each lives in its own file:

| Spec section | Where |
| --- | --- |
| **Target architecture** + end-to-end path | [04-system-design.md](./docs/04-system-design.md) + [architecture.md](./docs/architecture.md) |
| **Tenancy and isolation** (compute/data/secrets/net/IAM) | [04-system-design.md](./docs/04-system-design.md), [`foundation/tenants/`](./fleet-managers/terraform/foundation/tenants/) |
| **Observability and cost** — per-app attribution, **LLM token costs as a first-class signal**, **tracing across the agent/tool-call chain** | [09-llm-observability.md](./docs/09-llm-observability.md) + [`mcp-server/`](./mcp-server/) (the reference implementation) + [cost-and-observability.md](./docs/cost-and-observability.md) |
| **Guardrails** — prompt injection, PII, model allowlists, HITL, audit | [10-prompt-injection-and-pii.md](./docs/10-prompt-injection-and-pii.md) + [guardrails.md](./docs/guardrails.md) |
| **Lifecycle** — provisioning, updates, secret rotation, retirement | [07-rollout.md](./docs/07-rollout.md) (Ring 3 owns rotation + retirement) |
| **Ownership** — AI Infra vs DevOps | [08-ownership.md](./docs/08-ownership.md) — explicit boundary + three interface contracts |
| **Tradeoffs** — real decisions with reasoning | [06-tradeoffs.md](./docs/06-tradeoffs.md) — EKS vs App Runner, in-proc orchestrator vs Step Functions, public ALB vs internal-only, 1-level FQDN vs per-tenant |
| **Rollout shape** — what ships first / manual / unlocks 10x | [07-rollout.md](./docs/07-rollout.md) — three rings |

Plus the product-track docs that frame the platform:

| File | What it covers |
| --- | --- |
| [01-user-stories.md](./docs/01-user-stories.md) | 5 personas, 17 stories |
| [02-use-cases.md](./docs/02-use-cases.md) | 12 use cases, sequence diagrams |
| [03-qualification.md](./docs/03-qualification.md) | Honest scorecard — what's done, what's not yet |
| [05-onboarding-walkthrough.md](./docs/05-onboarding-walkthrough.md) | Click-by-click flow at portal.ssp.mightybee.dev |

## Code slices

The spec asks for ONE option. I built two; pick whichever to dig into:

| Option | Where |
| --- | --- |
| **A — Per-tenant isolation Terraform module** | [`fleet-managers/terraform/foundation/tenants/alice/`](./fleet-managers/terraform/foundation/tenants/alice/) — namespace, NetworkPolicy, ResourceQuota, IRSA, all parameterized. Applied live. |
| **B — Observability MCP server** | [`mcp-server/`](./mcp-server/) — three tools (`start_span` / `end_span` / `record_llm_call` / `log_guarded_action`) over the stdio MCP transport, with a toy app demonstrating one CR end-to-end including a PII block. Emits CloudWatch EMF events. |
| **D — Portal slice** *(building it was unavoidable to make the rest concrete)* | [`llm-product-poc/`](./llm-product-poc/) — Next.js 15 + Drizzle + Postgres + Bedrock + Octokit, served live at `portal.ssp.mightybee.dev`. |

Option C (guardrails middleware) lives partially in
[`llm-product-poc/src/lib/policy/gate.ts`](./llm-product-poc/src/lib/policy/gate.ts)
(deterministic rules) and [`llm-product-poc/src/lib/ai/prompts.ts`](./llm-product-poc/src/lib/ai/prompts.ts)
(model allowlist + image registry allowlist).

## Deliberate deviations from the spec

| What | Why |
| --- | --- |
| Public ALB + WAF instead of internal-only | Eval reviewer needs a clickable URL; internal-only would have added 1–2h for a private hosted zone + Client VPN with no architectural signal. The shape is the same — flip `scheme=internet-facing` to `scheme=internal` on the LBC `LoadBalancerConfiguration` and re-issue the cert in a private zone. |
| Built more than the 3–4h budget | The portal had to exist for the MCP server's contract to be honest. I optimised for code that's **actually runnable end-to-end** at the cost of personal time. Spec says "judgment over polish, volume of code is not a signal" — I've taken that seriously where it counts (the docs are tight, opinionated, file-referenced) and accepted the over-build only where it made the architecture concrete. |

## What I'd do next given another full day

In priority order:

1. **Wire the MCP into the portal.** The MCP server + design exist; the
   orchestrator still writes to stdout. ~2h to make `meteredInvoke` call
   `record_llm_call`, and to thread `cr_id` as the trace ID through every
   subsequent emit. Closes the spec's LLM observability gap in code, not
   just design.

2. **Add the output-YAML re-validation layer** to the guardrail stack —
   parse the AI's generated `values.yaml` and assert no
   `securityContext.privileged=true`, no `hostNetwork`, no `hostPath`. Two
   hours; closes prompt-injection defence layer 4 (see
   [10-prompt-injection-and-pii.md](./docs/10-prompt-injection-and-pii.md)).

3. **Replace the in-process orchestrator with Step Functions.** Unblocks
   portal HA, gives durable retries on Bedrock throttle. Half-day.

4. **Service retirement CR.** A "decommission" CR that scales the Deployment
   to 0, drops the HTTPRoute, sets `services.deletedAt`, revokes IRSA. Closes
   the lifecycle gap. Half-day.

5. **Per-tenant Bedrock budget enforcement.** Currently a CR loop could burn
   $$ before the budget alarm fires. Once the MCP wiring lands, add a
   "current spend > cap" guard in the orchestrator. Two hours.

## AI tools — how I used them, where I overrode

This is the part the spec calls out as not throwaway. Honest take.

**What I used:**
- **Claude Code** (this session) — primary driver. Roughly 95% of the diff in
  this repo passed through it.
- **Claude Opus 4.6 via Bedrock** — runs inside the deployed portal itself;
  it's the AI agent that validates CRs and generates artifacts.

**Where AI helped:**
- **Drafting Terraform** — VPC, EKS, ALB, ACM, WAF, ECR, Cognito, Secrets
  Manager modules. The structure was right out of the gate; I edited values,
  added the cost-allocation tags, fixed two real bugs (one wrong
  Cognito-client setting; one ALB target type that landed on instance-mode
  instead of IP-mode).
- **Mermaid diagrams** — every diagram in `docs/` was drafted by the AI then
  edited for accuracy. The "two-level FQDN broke TLS" lesson came from
  reality, not the model; I had to push back on its first attempt that
  blithely showed `*.alice.ssp.mightybee.dev` covered by the wildcard cert.
- **The MCP server skeleton** — the stdio transport + tool routing was AI;
  the EMF format choice and the pricing-table-not-API decision were mine
  after watching the cost numbers move (we don't want a Bedrock pricing-API
  call gating every LLM invocation).
- **Status timeline UI** — the React component that renders the
  exists/healthy badges next to each revision. Worked first try; spent the
  saved time on the orchestrator's state model.

**Where I overrode:**
- **Two-level FQDN.** The model defaulted to `<sub>.<tenant>.ssp.mightybee.dev`
  because "tenant context belongs in the URL." I let it go for the first
  round, watched it fail TLS handshake on every tenant route, and rewrote
  the prompt to enforce one-level. **The model didn't suggest checking
  wildcard depth — that's the kind of constraint the AI doesn't know unless
  you tell it.** Documented in [06-tradeoffs.md](./docs/06-tradeoffs.md) #4.
- **Probing all revisions vs. latest only.** AI's first cut probed every
  revision with `existence='created'`. That made superseded revisions
  perpetually unhealthy and clobbered `service.currentStatus` via the
  mirror. I added `SELECT DISTINCT ON (service_id) ... ORDER BY created_at
  DESC` myself; the model didn't volunteer the multi-revision issue.
- **Application name determinism.** First AI-generated `argocd Application`
  manifest had `metadata.name: api-service`; the hot-fix CR generated it as
  `alice-api-service`. App-of-apps treated these as two different
  Applications, orphaned the original Deployment and HTTPRoute, and both
  fought over the same hostname. I caught this in production logs,
  diagnosed it, and added the `metadata.name` lock + `resources-finalizer`
  to the system prompt. **The fix is in the prompt — the AI now obeys it
  every time. But finding it required me running real CRs and watching the
  cluster state, not asking the AI to review its own work.**
- **Prober gating.** AI built `startProber()` to fire at module load. That
  worked when only the portal ran the image — but every tenant pod that
  reuses the portal image also got a prober, all spamming ECONNREFUSED
  against a `DATABASE_URL` they didn't have. I made it opt-in via
  `SSP_PORTAL_PROBER=true`. **AI wanted to gate it on `DATABASE_URL`
  presence; I rejected that because hr-portal has DATABASE_URL too. The
  right gate is a portal-specific signal.**
- **The deliverable framing in this doc.** AI's first draft of the README's
  AI-tools section was too positive — "AI helped with X, Y, Z." I rewrote
  it to lead with overrides. The spec is explicitly scoring how I
  *override*, not just how I use.

**One pattern that worked well**: I kept asking the AI to surface
**deliberate deviations** at every commit — "we're doing X, the alternative
is Y, here's why X." That forced the AI to articulate trade-offs in its own
code comments, which made the [06-tradeoffs.md](./docs/06-tradeoffs.md) doc
mostly an editorial pass over comments already in the codebase.

**One pattern that didn't**: asking the AI to predict failure modes ahead
of time. Every architectural mistake in this build (the two-level FQDN, the
duplicate ArgoCD Application, the prober in tenant pods) was something the
AI cheerfully built and I caught later by running real traffic. **The model
is good at building the happy path; humans still find the corner.** Treating
AI output as something to be **stress-tested**, not **reviewed**, made the
biggest difference.

---

## Status

All foundation layers live in this account (`195748744911`, eu-west-1). The
portal serves real traffic on real DNS with a real TLS cert behind a WAFv2 ACL.
Bedrock Opus 4.6 is wired through IRSA to the portal pod. Every approved
ChangeRequest opens a real GitHub PR against this repo. See
[docs/e2e-evidence.md](./docs/e2e-evidence.md) for the receipts.

## Layout

```
alice/
├── README.md                       ← you are here
├── mcp-server/                     ← Deliverable 2 Option B (MCP)
├── llm-product-poc/                ← Portal: Next.js + Drizzle + Bedrock
├── fleet-managers/
│   ├── terraform/foundation/
│   │   ├── 00-bootstrap → 80-cost-governance, tenants/<name>/
│   ├── helm/app/                   ← One chart for any service
│   ├── argocd/apps/                ← App-of-Apps root
│   ├── platform-apps/ssp-portal/   ← Portal's own Helm values
│   └── tenants/<dom>/apps/<svc>/   ← AI-generated, human-reviewed
└── docs/
    ├── 01-user-stories.md → 10-prompt-injection-and-pii.md
    └── architecture.md, guardrails.md, cost-and-observability.md, e2e-evidence.md
```
