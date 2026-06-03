# SSP Observability MCP server

A small MCP server vibe-coded apps consume to make their behaviour visible to
the platform. Three tools:

| Tool | What it does | Closes spec gap |
| --- | --- | --- |
| `start_span` / `end_span` | Open + close a trace span. Spans nest via `parent_span_id`. | "Tracing across the agent / tool-call chain" |
| `check_budget` | Pre-flight: ask the portal whether the tenant has Bedrock budget left this month. Returns `{ok, spent_usd, cap_usd, remaining_usd}`. **Honour `ok=false` by refusing to invoke Bedrock — the platform has already over-cap warned.** | The per-tenant cost guardrail. |
| `record_llm_call` | Record one Bedrock invocation: model, tokens, computed USD cost, latency. Also POSTs to the portal's internal API so the next `check_budget` reflects this call. | "LLM token costs as a first-class signal" |
| `log_guarded_action` | Append-only audit log for sensitive operations (PII block, allowlist refusal, self-refusal-over-budget). | "Audit trail" + the guarded-action half of "Guardrails" |

## Why this shape

Every event is emitted as **one JSON line on stderr** in CloudWatch Embedded
Metric Format (EMF). (stdout is reserved for the MCP JSON-RPC protocol; stderr
is captured identically by Container Insights / CW agents.) That gives us three
things for free:

1. **Logs**: CW Logs Insights queries `_aws.CloudWatchMetrics[*]` and the
   per-event attributes. Filter on `tenant_id`, `trace_id`, `action`, etc.
2. **Metrics**: CW automatically extracts `SpanDurationMs`, `TokensInput`,
   `TokensOutput`, `CostUSD` from EMF events and produces dimensional metrics
   keyed on `tenant_id` + `model`.
3. **OpenTelemetry**: FluentBit / Vector can tail stdout and re-emit as OTLP
   spans (the `start_span`/`end_span` payloads carry parent/child semantics).

No persistent state in this process. The MCP server is **a translator**: app
makes a structured call, platform receives a structured event. Aggregation,
storage, and alerting live downstream.

## Files

```
mcp-server/
├── src/
│   ├── server.ts        # MCP stdio server + 3 tools
│   └── pricing.ts       # per-model USD/1M token rates (Claude Opus/Sonnet/Haiku)
├── toy-app/
│   └── app.ts           # demo client that simulates a CR with AI + PII block
├── package.json
├── tsconfig.json
└── README.md
```

## Two integration paths

### 1. The SSP portal (orchestrator) — library mode

The portal speaks the MCP schema in-process via
`llm-product-poc/src/lib/observability/`. Same `pricing.ts`, same EMF
emission format, same `check_budget` semantics. No IPC because the portal
owns its trace IDs. The portal's `meteredBedrockInvoke()` is the production
implementation: wraps Bedrock with span open/close + DB insert + EMF emit.

### 2. A vibe-coded tenant app — stdio mode

A vibe-coded app spawned in a tenant namespace runs this MCP server as a
sidecar (or stdio child) and consumes the three tools to inherit the
platform's guardrails:

```
tenant_app                  mcp-server (this)              portal
    │                            │                            │
    │── check_budget(tenant) ───▶│                            │
    │                            │── GET /budget/<id> ───────▶│
    │                            │◀── {ok, spent, cap} ───────│
    │◀── {ok:false} ─────────────│                            │
    │  (refuse to invoke)        │                            │
    │── (Bedrock invoke skipped) │                            │
    │── log_guarded_action(...) ▶│                            │
    │                            │ emit EMF to CloudWatch     │
```

If `ok=true` the app calls Bedrock with its own IRSA role, then:

```
    │── record_llm_call(usage) ─▶│
    │                            │── POST /llm-calls ────────▶│
    │                            │── emit EMF event ─────────▶ CW
```

The contract is **trust-based** for MVP1 — the app could bypass MCP and
call Bedrock directly. Ring 3 adds an in-cluster Bedrock proxy + NetworkPolicy
that forces all egress through the proxy, making the contract enforced.

Env the tenant app must set when spawning this server:

| Env | Required | Notes |
| --- | --- | --- |
| `SSP_PORTAL_API` | yes | e.g. `https://portal.ssp.mightybee.dev` |
| `SSP_INTERNAL_TOKEN` | yes | Mounted by ESO from `ssp/<tenant>/api-token`. |
| `SSP_OBSERVABILITY_DISABLED` | no | If `true`, MCP runs silently — useful for unit tests. |

## Run the toy apps

```sh
cd mcp-server
npm install

# 1) original toy — pretends to be the SSP orchestrator: opens spans, records
#    an LLM call with the EMF format, logs a PII-block guarded action.
npm run toy

# 2) tenant toy — pretends to be a vibe-coded tenant app: check_budget first,
#    invoke (simulated) Bedrock, record_llm_call. Reach a live portal:
SSP_PORTAL_API=https://portal.ssp.mightybee.dev \
  SSP_INTERNAL_TOKEN=$(aws secretsmanager get-secret-value \
    --secret-id ssp/portal/internal-token --query SecretString --output text --profile alice \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])') \
  SSP_TENANT_ID=cbdbfcd6373448318d82ddc58d \
  npm run tenant
```

You'll see JSON lines on stderr — span open/close, llm_call with computed
cost, and the guarded_action. Each script ends with a printed summary on
stderr (so it doesn't pollute the metric stream).

Sample output (truncated):

```json
{"service":"ssp","event":"span","trace_id":"01KT...","span_id":"...","span_name":"orch.ai_invoke.bedrock_call","duration_ms":11203,"SpanDurationMs":11203,"status":"ok","attributes":{"model":"eu.anthropic.claude-opus-4-6-v1","cost_usd":0.061}}
{"service":"ssp","event":"llm_call","tenant_id":"alice","cr_id":"01KT...","model":"eu.anthropic.claude-opus-4-6-v1","TokensInput":2843,"TokensOutput":812,"CostUSD":0.061,"_aws":{...}}
{"service":"ssp","event":"guarded_action","tenant_id":"alice","actor_user_id":"user-7f1b2c","action":"cr.pii_rejected","outcome":"blocked","detail":"contained: EMAIL ********@*****.com"}
```

## Wire to the SSP orchestrator

In `llm-product-poc/src/lib/ai/agent.ts` the direct `bedrockClient.send(...)`
becomes:

```ts
import { obsClient } from "@/lib/observability/mcp-client"; // stdio child managed by portal

const aiSpan = await obsClient.startSpan({
  trace_id: cr.id,
  parent_span_id: rootSpanId,
  name: "orch.ai_invoke.bedrock_call",
  attributes: { tenant_id: tenant.id, model },
});

const t0 = Date.now();
const res = await bedrockClient.send(...);
await obsClient.recordLlmCall({
  tenant_id: tenant.id,
  cr_id: cr.id,
  model,
  input_tokens: res.usage.input_tokens,
  output_tokens: res.usage.output_tokens,
  cache_read_tokens: res.usage.cache_read_input_tokens,
  latency_ms: Date.now() - t0,
});
await obsClient.endSpan({ span_id: aiSpan, status: "ok" });
```

(The thin client wrapper isn't built yet — it's mechanical once the MCP server
is deployed alongside the portal as a sidecar.)

## Why MCP and not OTel SDK directly?

- The vibe coder's app is the consumer. They get **tools**, not a library —
  the same MCP that surfaces `Read`, `Edit`, etc. surfaces these. Zero
  language-binding cost (any MCP client, any language).
- **Schema-enforced inputs** (every tool has a Zod schema). The vibe coder
  literally can't omit `tenant_id` because the tool call fails server-side.
- **Audit by construction**: every tool call is a discrete event we can
  inspect; there's no escape valve where someone bypasses the meter and goes
  direct to Bedrock from inside the app — if they do, the call doesn't have a
  trace ID and is visible as such in queries.

In other words: MCP is the **API contract** between the apps and the
platform. OTel is one of several downstream consumers of what the MCP emits.

## What's NOT in this slice

- No client wrapper inside the portal yet — Ring 2 (see
  [`../docs/09-llm-observability.md`](../docs/09-llm-observability.md) for the
  full plan).
- No durable queue — if the MCP process crashes mid-call, that event is lost.
  Stdout buffering on the parent + a CW agent retry semantics covers ≥99% of
  this in practice, but it's not a durability guarantee.
- No client-side budget enforcement — that's the orchestrator's job (it
  queries `SUM(cost_usd) WHERE tenant_id` from the downstream store before
  each call). The MCP only records; it does not refuse.
