#!/usr/bin/env node
/**
 * SSP Observability MCP server.
 *
 * Three tools that vibe-coded apps (and the SSP orchestrator itself) consume to
 * make their behaviour visible to the platform:
 *
 *   - emit_span         start/end a trace span, optionally with attributes.
 *   - record_llm_call   record token usage + computed USD cost for one Bedrock invoke.
 *   - log_guarded_action  audit log for a sensitive operation (PII-rejection, prompt-
 *                         injection-block, image-allowlist-rejection, etc.).
 *
 * Events are emitted as JSON lines on stdout — this is the CloudWatch Embedded
 * Metric Format pattern: parseable as logs AND as metrics by CW Logs Insights.
 * In production, run this as a sidecar to the orchestrator pod; stdout goes to
 * Container Insights → CW → tenant-scoped metric dimensions.
 *
 * No persistent state inside this process; the source of truth is downstream
 * (CW Logs, an OTel collector if configured). Tested with the toy app in
 * ../toy-app/app.ts.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { computeCostUSD, PRICING } from "./pricing.js";

const server = new Server(
  { name: "ssp-observability-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// ---------------------------------------------------------------------------
// In-process span store. Only here so end_span can compute duration_ms; we don't
// queue or batch — every end emits one JSON line and the row is forgotten.
// ---------------------------------------------------------------------------
type SpanState = {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  name: string;
  startedAtMs: number;
  attributes: Record<string, string | number | boolean>;
};
const liveSpans = new Map<string, SpanState>();

function ulid(): string {
  // Tiny ULID-ish — collision-resistant enough for trace IDs in a single process.
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 12)
  ).toUpperCase();
}

function emit(record: Record<string, unknown>) {
  // One JSON line per event, on STDERR. We can't use stdout here — the MCP
  // stdio transport owns stdout for the JSON-RPC protocol channel. stderr is
  // free, and Container Insights / CW agents pick up both stdout and stderr
  // identically, so downstream metric extraction works the same way.
  process.stderr.write(JSON.stringify(record) + "\n");
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
const startSpanInput = z.object({
  trace_id: z
    .string()
    .min(1)
    .describe("Trace ID to attach this span to — caller MUST pass the same trace_id for every span in one workflow run. Conventionally the CR ID."),
  parent_span_id: z
    .string()
    .optional()
    .describe("Parent span ID for nested operations. Omit for root spans."),
  name: z
    .string()
    .min(1)
    .describe("Span name. Conventionally dot-separated: 'orch.policy_gate', 'orch.ai_invoke.bedrock_call'."),
  attributes: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Free-form attributes; tenant_id and cr_id strongly recommended."),
});

const endSpanInput = z.object({
  span_id: z.string().min(1).describe("Span ID returned by start_span."),
  status: z
    .enum(["ok", "error"])
    .default("ok")
    .describe("Outcome of the operation the span covers."),
  attributes: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Additional attributes set at span end — typically error_message on status=error."),
});

const recordLlmCallInput = z.object({
  tenant_id: z
    .string()
    .min(1)
    .describe("Tenant whose budget should be debited. The platform aggregates by this dimension."),
  cr_id: z
    .string()
    .optional()
    .describe("CR ID this call was part of, when applicable."),
  model: z
    .string()
    .min(1)
    .describe("Model ID, e.g. 'eu.anthropic.claude-opus-4-6-v1'. Must be in the pricing table or cost_usd returns NaN and the platform rejects."),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_read_tokens: z.number().int().nonnegative().optional(),
  cache_write_tokens: z.number().int().nonnegative().optional(),
  latency_ms: z.number().nonnegative().optional(),
});

const checkBudgetInput = z.object({
  tenant_id: z
    .string()
    .min(1)
    .describe("Tenant whose Bedrock monthly cap to check before invoking the model. Returns { ok, spent_usd, cap_usd, remaining_usd }."),
});

const logGuardedActionInput = z.object({
  tenant_id: z.string().min(1),
  actor_user_id: z.string().min(1).describe("User who attempted the action."),
  action: z
    .string()
    .min(1)
    .describe("Action identifier — convention 'category.outcome', e.g. 'cr.pii_rejected', 'image.allowlist_blocked', 'prompt.injection_detected'."),
  resource: z
    .string()
    .optional()
    .describe("Resource the action was against, e.g. 'service:01KT4VQ06937KK4JNTCTJA20C8'."),
  outcome: z
    .enum(["allowed", "blocked", "warning"])
    .describe("What the platform did about it."),
  detail: z
    .string()
    .optional()
    .describe("Free-text. KEEP REDACTED — never store raw PII or secrets here."),
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "start_span",
      description:
        "Open a span representing a unit of work. Returns the span_id you must pass back to end_span.",
      inputSchema: zodToJsonSchema(startSpanInput),
    },
    {
      name: "end_span",
      description: "Close a previously-opened span and emit it as one JSON-line event.",
      inputSchema: zodToJsonSchema(endSpanInput),
    },
    {
      name: "check_budget",
      description:
        "Pre-flight cost guardrail. Call before invoking Bedrock; the platform returns whether the tenant has Bedrock budget remaining this calendar month. Honour the {ok:false} result by refusing to invoke — the tenant has already been over-cap warned and another call will not bill, only debit your audit log.",
      inputSchema: zodToJsonSchema(checkBudgetInput),
    },
    {
      name: "record_llm_call",
      description:
        "Record one LLM invocation: token usage, model, computed USD cost. The platform aggregates these per tenant/model for budgets and dashboards. Also POSTs to the portal's internal API so the next check_budget reflects this call (best-effort; falls back to EMF-only if the API is unreachable).",
      inputSchema: zodToJsonSchema(recordLlmCallInput),
    },
    {
      name: "log_guarded_action",
      description:
        "Audit log for a sensitive operation — PII rejection, prompt injection, image-allowlist block, privilege-escalation attempt. Append-only.",
      inputSchema: zodToJsonSchema(logGuardedActionInput),
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    switch (req.params.name) {
      case "start_span": {
        const args = startSpanInput.parse(req.params.arguments);
        const spanId = ulid();
        liveSpans.set(spanId, {
          spanId,
          parentSpanId: args.parent_span_id,
          traceId: args.trace_id,
          name: args.name,
          startedAtMs: Date.now(),
          attributes: args.attributes ?? {},
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ span_id: spanId }) }],
        };
      }

      case "end_span": {
        const args = endSpanInput.parse(req.params.arguments);
        const span = liveSpans.get(args.span_id);
        if (!span) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `span_id ${args.span_id} not found (already ended or never started)`,
              },
            ],
          };
        }
        liveSpans.delete(args.span_id);
        const durationMs = Date.now() - span.startedAtMs;
        emit({
          _aws: {
            // CloudWatch EMF dimensions — CW reads this and produces metrics from
            // the named fields. One metric per dimension combination.
            CloudWatchMetrics: [
              {
                Namespace: "SSP/Spans",
                Dimensions: [["service", "span_name"]],
                Metrics: [{ Name: "SpanDurationMs", Unit: "Milliseconds" }],
              },
            ],
            Timestamp: Date.now(),
          },
          service: "ssp",
          event: "span",
          trace_id: span.traceId,
          span_id: span.spanId,
          parent_span_id: span.parentSpanId,
          span_name: span.name,
          duration_ms: durationMs,
          SpanDurationMs: durationMs,
          status: args.status,
          attributes: { ...span.attributes, ...(args.attributes ?? {}) },
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, duration_ms: durationMs }),
            },
          ],
        };
      }

      case "check_budget": {
        const args = checkBudgetInput.parse(req.params.arguments);
        const portalRes = await callPortal(
          `/api/internal/budget/${encodeURIComponent(args.tenant_id)}`,
          "GET",
        );
        if (!portalRes.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `portal budget endpoint failed: ${portalRes.error}`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(portalRes.body) }],
        };
      }

      case "record_llm_call": {
        const args = recordLlmCallInput.parse(req.params.arguments);
        const costUsd = computeCostUSD(args.model, {
          inputTokens: args.input_tokens,
          outputTokens: args.output_tokens,
          cacheReadTokens: args.cache_read_tokens,
          cacheWriteTokens: args.cache_write_tokens,
        });
        if (Number.isNaN(costUsd)) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `model ${args.model} not in pricing table — refusing to record an uncosted call (allowlist drift)`,
              },
            ],
          };
        }
        // Best-effort POST to the portal so checkBudget reflects this call.
        // If the API is unreachable we still emit the EMF event — the platform's
        // CW-based aggregation catches it within ~1min.
        callPortal("/api/internal/llm-calls", "POST", {
          tenant_id: args.tenant_id,
          change_request_id: args.cr_id,
          model: args.model,
          input_tokens: args.input_tokens,
          output_tokens: args.output_tokens,
          cache_read_tokens: args.cache_read_tokens ?? 0,
          cache_write_tokens: args.cache_write_tokens ?? 0,
          latency_ms: args.latency_ms,
        }).catch((err) => {
          process.stderr.write(
            JSON.stringify({
              service: "ssp",
              event: "mcp_portal_post_failed",
              detail: err instanceof Error ? err.message : String(err),
            }) + "\n",
          );
        });
        emit({
          _aws: {
            CloudWatchMetrics: [
              {
                Namespace: "SSP/Bedrock",
                Dimensions: [
                  ["tenant_id", "model"],
                  ["model"],
                ],
                Metrics: [
                  { Name: "TokensInput", Unit: "Count" },
                  { Name: "TokensOutput", Unit: "Count" },
                  { Name: "CostUSD", Unit: "None" },
                  ...(args.latency_ms !== undefined
                    ? [{ Name: "LatencyMs", Unit: "Milliseconds" }]
                    : []),
                ],
              },
            ],
            Timestamp: Date.now(),
          },
          service: "ssp",
          event: "llm_call",
          tenant_id: args.tenant_id,
          cr_id: args.cr_id,
          model: args.model,
          TokensInput: args.input_tokens,
          TokensOutput: args.output_tokens,
          cache_read_tokens: args.cache_read_tokens ?? 0,
          cache_write_tokens: args.cache_write_tokens ?? 0,
          CostUSD: costUsd,
          LatencyMs: args.latency_ms,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, cost_usd: costUsd }),
            },
          ],
        };
      }

      case "log_guarded_action": {
        const args = logGuardedActionInput.parse(req.params.arguments);
        emit({
          service: "ssp",
          event: "guarded_action",
          tenant_id: args.tenant_id,
          actor_user_id: args.actor_user_id,
          action: args.action,
          resource: args.resource,
          outcome: args.outcome,
          detail: args.detail,
          ts: new Date().toISOString(),
        });
        return {
          content: [
            { type: "text", text: JSON.stringify({ ok: true }) },
          ],
        };
      }

      default:
        return {
          isError: true,
          content: [{ type: "text", text: `unknown tool: ${req.params.name}` }],
        };
    }
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }
});

// ---------------------------------------------------------------------------
// Portal HTTP client — used by check_budget + record_llm_call to talk to the
// platform's internal API. Auth is a shared bearer token mounted via ESO into
// the tenant pod. Both URL and token come from env so the MCP server doesn't
// hardcode anything.
// ---------------------------------------------------------------------------
type PortalResult =
  | { ok: true; body: any }
  | { ok: false; error: string; status?: number };

async function callPortal(
  path: string,
  method: "GET" | "POST",
  body?: any,
): Promise<PortalResult> {
  const base = process.env.SSP_PORTAL_API;
  const token = process.env.SSP_INTERNAL_TOKEN;
  if (!base) return { ok: false, error: "SSP_PORTAL_API env not set" };
  if (!token) return { ok: false, error: "SSP_INTERNAL_TOKEN env not set" };
  const url = base.replace(/\/$/, "") + path;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // body wasn't JSON; expose raw text on error path
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error:
          parsed?.error ??
          parsed?.detail ??
          `http ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true, body: parsed };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// JSON-Schema conversion (zod → MCP). MCP expects raw JSON Schema; we keep a
// tiny inline translator instead of pulling zod-to-json-schema.
// ---------------------------------------------------------------------------
function zodToJsonSchema(schema: z.ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<any>).shape;
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const child = v as z.ZodTypeAny;
      properties[k] = zodToJsonSchema(child);
      if (!child.isOptional()) required.push(k);
    }
    return { type: "object", properties, required };
  }
  if (schema instanceof z.ZodString) return { type: "string", description: (schema as any)._def.description };
  if (schema instanceof z.ZodNumber) return { type: "number", description: (schema as any)._def.description };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum) return { type: "string", enum: (schema as any)._def.values };
  if (schema instanceof z.ZodOptional) return zodToJsonSchema((schema as any)._def.innerType);
  if (schema instanceof z.ZodDefault) return zodToJsonSchema((schema as any)._def.innerType);
  if (schema instanceof z.ZodRecord) {
    return { type: "object", additionalProperties: zodToJsonSchema((schema as any)._def.valueType) };
  }
  if (schema instanceof z.ZodUnion) {
    return { anyOf: (schema as any)._def.options.map(zodToJsonSchema) };
  }
  return {};
}

// ---------------------------------------------------------------------------
// stdio transport — MCP standard. Run as a child process from the consumer.
// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("ssp-observability-mcp ready (stdio)"); // stderr — stdout is the metric stream
