#!/usr/bin/env tsx
/**
 * Toy TENANT app demonstrating the cost-guardrail contract for vibe-coded
 * apps that run inside a tenant namespace.
 *
 * Pattern:
 *   1. spawn MCP server (sidecar or stdio child)
 *   2. before invoking Bedrock: call `check_budget`. If {ok:false}, abort.
 *   3. call Bedrock with the tenant's IRSA role
 *   4. after the call: call `record_llm_call` with the actual usage
 *
 * The MCP server in this folder is the documented contract. Vibe coders who
 * follow it inherit budget guardrails + tracing for free. The deal: bypass
 * the contract and you bypass the guardrails, but the platform's CloudTrail
 * + per-tenant Cost Explorer line still surfaces unmetered usage.
 *
 * Env required:
 *   SSP_PORTAL_API     https://portal.ssp.mightybee.dev
 *   SSP_INTERNAL_TOKEN <bearer> (mounted by ESO from ssp/<tenant>/api-token)
 *
 * Run locally:
 *   SSP_PORTAL_API=https://portal.ssp.mightybee.dev SSP_INTERNAL_TOKEN=<...> npm run tenant
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(__dirname, "../src/server.ts");

const TENANT_ID = process.env.SSP_TENANT_ID ?? "alice";
const MODEL = "eu.anthropic.claude-haiku-4-5-v1";

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", serverPath],
    env: {
      ...process.env,
      // Propagate the portal URL + token to the MCP child so its
      // check_budget / record_llm_call calls succeed.
      SSP_PORTAL_API: process.env.SSP_PORTAL_API ?? "",
      SSP_INTERNAL_TOKEN: process.env.SSP_INTERNAL_TOKEN ?? "",
    },
  });

  const client = new Client(
    { name: "toy-tenant-app", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  // -- Step 1: pre-flight budget check ---------------------------------------
  console.error(`[tenant ${TENANT_ID}] check_budget...`);
  const budgetRes = await client.callTool({
    name: "check_budget",
    arguments: { tenant_id: TENANT_ID },
  });
  if (budgetRes.isError) {
    console.error(
      "[tenant] portal unreachable or unconfigured:",
      JSON.stringify(budgetRes.content),
    );
    await client.close();
    process.exit(1);
  }
  const budget = JSON.parse(
    (budgetRes.content as Array<{ text: string }>)[0].text,
  );
  console.error(
    `[tenant] budget: spent=$${budget.spent_usd?.toFixed?.(4) ?? budget.spent_usd} of $${budget.cap_usd}, ok=${budget.ok}`,
  );
  if (!budget.ok) {
    // GUARDRAIL FIRED: do NOT invoke Bedrock. Surface the refusal as a
    // guarded action so the platform sees that the tenant correctly refused
    // (as opposed to a tenant that bypasses and calls Bedrock anyway).
    await client.callTool({
      name: "log_guarded_action",
      arguments: {
        tenant_id: TENANT_ID,
        actor_user_id: "tenant-app",
        action: "bedrock.self_refused_over_budget",
        outcome: "blocked",
        detail: `tenant app correctly refused per check_budget: spent $${budget.spent_usd} of $${budget.cap_usd}`,
      },
    });
    console.error(
      `[tenant] OVER BUDGET — refusing to invoke Bedrock. Exit.`,
    );
    await client.close();
    process.exit(0);
  }

  // -- Step 2: pretend to invoke Bedrock --------------------------------------
  // In production: BedrockRuntimeClient.send(InvokeModelCommand(...)) here,
  // assuming the tenant pod's IRSA role allows it.
  const fakeUsage = { input_tokens: 350, output_tokens: 120, latency_ms: 800 };
  console.error(
    `[tenant] (pretend) invoked ${MODEL}: in=${fakeUsage.input_tokens} out=${fakeUsage.output_tokens}`,
  );

  // -- Step 3: record the call so the next check_budget sees this spend ------
  const recRes = await client.callTool({
    name: "record_llm_call",
    arguments: {
      tenant_id: TENANT_ID,
      model: MODEL,
      input_tokens: fakeUsage.input_tokens,
      output_tokens: fakeUsage.output_tokens,
      latency_ms: fakeUsage.latency_ms,
    },
  });
  if (recRes.isError) {
    console.error("[tenant] record_llm_call failed:", JSON.stringify(recRes.content));
  } else {
    const rec = JSON.parse(
      (recRes.content as Array<{ text: string }>)[0].text,
    );
    console.error(`[tenant] recorded call: cost_usd=$${rec.cost_usd}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
