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

The platform is **already running** in the user's AWS account
(`195748744911`, eu-west-1). For a reviewer who wants to look at it, the
high-signal artifacts:

```sh
# 1. Chat (the demo workload — Cognito-gated, metered Bedrock per message)
open https://chat.ssp.mightybee.dev/chat/login
#    user: namnh21894@gmail.com
#    pass: ChatDemo!2026

# 2. Admin portal — see the chat service detail page with the usage widget
open https://portal.ssp.mightybee.dev/dashboard/services/01KTC00CHATSV00000000000001

# 3. The most recent AI-generated PR
open https://github.com/nguyenhoangnam123/alice-ssp/pull/17

# 4. Run the observability MCP server locally (no AWS needed)
cd mcp-server
npm install
npm run toy      # orchestrator-side: spans + llm_call + guarded_action
npm run tenant   # tenant-side: check_budget → simulate Bedrock → record_llm_call
                 # (requires SSP_PORTAL_API + SSP_INTERNAL_TOKEN env)
```

Every chat message exercises the **full guardrail stack**: Cognito sign-in →
`checkBudget(tenantId)` → `meteredBedrockInvoke()` → Bedrock → `INSERT
llm_calls` → CW EMF emit → span close. Drop `tenants.bedrock_monthly_cap_usd`
to `0.01` and the next send returns HTTP 402 with the platform's refusal
reason; Bedrock is never called.

The CR-creation guardrails are exercised by `tests/fuzz-guardrails.sh` —
12 adversarial CRs (prompt-injection variants + PII variants + an
output-YAML-violating valid description) submitted in sequence; the
script prints what each one rejected on and shows the redacted audit
detail. See `tests/fuzz-guardrails.md` for expected outcomes.

## Read first — Deliverable 1 (Design Doc)

Five files, mapped 1:1 to the spec's eight Deliverable-1 sections.

| File | Spec sections covered |
| --- | --- |
| [docs/deliverable1-01-architecture.md](./docs/deliverable1-01-architecture.md) | Target architecture + Tenancy & isolation |
| [docs/deliverable1-02-observability-and-cost.md](./docs/deliverable1-02-observability-and-cost.md) | Observability & cost — LLM token cost as first-class signal + tracing across the agent / tool-call chain |
| [docs/deliverable1-03-guardrails.md](./docs/deliverable1-03-guardrails.md) | Guardrails — prompt injection, PII, model allowlists, HITL, audit |
| [docs/deliverable1-04-lifecycle-and-ownership.md](./docs/deliverable1-04-lifecycle-and-ownership.md) | Lifecycle + Ownership boundary + Rollout shape |
| [docs/deliverable1-05-tradeoffs.md](./docs/deliverable1-05-tradeoffs.md) | Tradeoffs — four real decisions with reasoning + cost |

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

In priority order (LLM observability, budget guard, MCP wiring, chat —
all shipped in Ring 1):

1. **Add the output-YAML re-validation layer** to the guardrail stack —
   parse the AI's generated `values.yaml` and assert no
   `securityContext.privileged=true`, no `hostNetwork`, no `hostPath`. Two
   hours; closes prompt-injection defence layer 4.

2. **Replace the in-process orchestrator with Step Functions.** Unblocks
   portal HA, gives durable retries on Bedrock throttle. Half-day.

3. **Service retirement CR.** A "decommission" CR that scales the
   Deployment to 0, drops the HTTPRoute, sets `services.deletedAt`,
   revokes IRSA. Closes the lifecycle gap. Half-day.

4. **Per-tenant JWT for the MCP API.** Today the `/api/internal/*`
   endpoints share a single bearer token across the cluster. Swap for
   per-tenant short-lived JWTs so a leaked token can't be used against
   another tenant's data.

5. **Tracing propagation through GHA + ArgoCD.** Trace IDs currently
   join only portal spans. Thread `SSP_CR_ID` env var through GHA
   workflow steps; add `metadata.annotations["ssp.platform/cr-id"]` to
   ArgoCD Applications so cluster events inherit it.

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
  you tell it.** Documented in
  [deliverable1-05-tradeoffs.md](./docs/deliverable1-05-tradeoffs.md) #4.
- **Probing all revisions vs. latest only.** AI's first cut probed every
  revision with `existence='created'`. That made superseded revisions
  perpetually unhealthy and clobbered `service.currentStatus` via the
  mirror. I added `SELECT DISTINCT ON (service_id) ... ORDER BY created_at
  DESC` myself.
- **Application name determinism.** First AI-generated `argocd Application`
  manifest had `metadata.name: api-service`; the hot-fix CR generated it as
  `alice-api-service`. App-of-apps treated these as two different
  Applications, orphaned the original Deployment and HTTPRoute, and both
  fought over the same hostname. I caught this in production logs and
  added the `metadata.name` lock + `resources-finalizer` to the system
  prompt.
- **Prober gating.** AI built `startProber()` to fire at module load. That
  worked when only the portal ran the image — but every tenant pod that
  reuses the portal image also got a prober, all spamming ECONNREFUSED
  against a `DATABASE_URL` they didn't have. I made it opt-in via
  `SSP_PORTAL_PROBER=true`.
- **The chat's FK silent drop.** `meteredBedrockInvoke` originally
  required `crId: string` and inserted it into `llm_calls`. The chat
  passes a synthetic trace ID (`svc:<id>`) which FK-violated against
  `change_requests`. The catch block swallowed it as "non-fatal". I
  noticed because the usage widget kept showing `$0` after sending a
  chat message that clearly hit Bedrock — went looking at logs, found
  `insert or update violates foreign key constraint`. Made `crId`
  optional + nullable in the FK; bumped the log level from `.error` to
  `.warn`. **The AI built the FK without thinking about who else
  besides the orchestrator might call `meteredBedrockInvoke`. Reusing
  a function across boundaries surfaces the assumptions baked into its
  signature.**
- **The Haiku model ID guess.** I asked the AI to write the chat
  against Claude Haiku 4.5 to keep cost low. It wrote
  `eu.anthropic.claude-haiku-4-5-v1`. Bedrock rejected with "The
  provided model identifier is invalid." I switched to Opus 4.6 (the
  ID we'd already validated). **Model IDs are an external API the AI
  can't introspect; the cheap check is `aws bedrock list-foundation-models`,
  not asking the LLM.**
- **The chat system prompt lying.** AI wrote a system prompt that
  hardcoded "I'm Claude Haiku 4.5 through Bedrock." After switching to
  Opus 4.6 the model still said it was Haiku. I rewrote the prompt
  model-agnostic. **Models can't be the source of truth on their own
  identity — the cost dashboard is.**
- **The Cognito client secret discovery.** Sign-in failed with
  `NotAuthorizedException: Client ... is configured with secret but
  SECRET_HASH was not received`. The AI's first cut of the InitiateAuth
  call didn't include SECRET_HASH because it assumed a public client.
  Added the `crypto.createHmac('sha256', secret).update(username +
  client_id).digest('base64')` computation server-side. **AWS SDK error
  messages are usually precise about what's missing — read them first,
  ask the AI second.**
- **The deliverable framing in this doc.** AI's first draft of the
  README's AI-tools section was too positive — "AI helped with X, Y, Z."
  I rewrote it to lead with overrides. The spec is explicitly scoring
  how I *override*, not just how I use.

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
