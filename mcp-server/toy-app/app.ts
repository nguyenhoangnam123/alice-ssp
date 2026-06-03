#!/usr/bin/env tsx
/**
 * Toy vibe-coded app demonstrating MCP consumption.
 *
 * Simulates a CR run end-to-end:
 *  1. Open root span for the CR.
 *  2. Open nested span for the AI call.
 *  3. Pretend to call Bedrock; record token usage via record_llm_call.
 *  4. End the AI span.
 *  5. Simulate a PII detection that blocks; emit log_guarded_action.
 *  6. End the root span with status=error (because of the block).
 *
 * Run:   npm run toy
 * Watch: tail the parent process's stdout — every JSON line is an event the
 * platform would ingest.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "../src/server.ts");

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", serverPath],
  });
  const client = new Client(
    { name: "toy-vibe-coded-app", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  // Conventional trace ID = the CR being processed.
  const traceId = "01KT4VQ06AV2VA98T79EJ8REZX"; // a real CR ID from our DB
  const tenantId = "alice";

  // 1. Root span — the whole CR.
  const root = await call(client, "start_span", {
    trace_id: traceId,
    name: "orch.process_change_request",
    attributes: { tenant_id: tenantId, cr_id: traceId },
  });
  const rootSpanId = JSON.parse((root.content as Array<{ text: string }>)[0].text).span_id;

  // 2. Nested span — Bedrock invocation.
  const aiSpan = await call(client, "start_span", {
    trace_id: traceId,
    parent_span_id: rootSpanId,
    name: "orch.ai_invoke.bedrock_call",
    attributes: { model: "eu.anthropic.claude-opus-4-6-v1" },
  });
  const aiSpanId = JSON.parse((aiSpan.content as Array<{ text: string }>)[0].text).span_id;

  // 3. Record the token usage. Simulating a typical CR-generation call.
  const llmResult = await call(client, "record_llm_call", {
    tenant_id: tenantId,
    cr_id: traceId,
    model: "eu.anthropic.claude-opus-4-6-v1",
    input_tokens: 2843,
    output_tokens: 812,
    cache_read_tokens: 2400, // system prompt was cached
    cache_write_tokens: 0,
    latency_ms: 11200,
  });
  const cost = JSON.parse((llmResult.content as Array<{ text: string }>)[0].text).cost_usd;

  await call(client, "end_span", {
    span_id: aiSpanId,
    status: "ok",
    attributes: { cost_usd: cost },
  });

  // 4. PII detection blocks the CR — write the audit log.
  await call(client, "log_guarded_action", {
    tenant_id: tenantId,
    actor_user_id: "user-7f1b2c",
    action: "cr.pii_rejected",
    resource: "change_request:" + traceId,
    outcome: "blocked",
    // Detail is REDACTED — we never store the raw PII the scanner found.
    detail: "contained: EMAIL ********@*****.com, IP_ADDRESS ***.***.***.***",
  });

  // 5. End root with error because the action was blocked.
  await call(client, "end_span", {
    span_id: rootSpanId,
    status: "error",
    attributes: { error_message: "blocked: PII detected in description" },
  });

  console.error(
    `\ntoy app done. CR was simulated → AI cost $${cost.toFixed(6)} → PII block.\n` +
      `Above this line are the JSON events the MCP emitted; in production they go to CW.\n`,
  );

  await client.close();
}

async function call(client: Client, name: string, args: any) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    throw new Error(`tool ${name} failed: ${JSON.stringify(res.content)}`);
  }
  return res;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
