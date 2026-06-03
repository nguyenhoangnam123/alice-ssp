// Per-1M-token USD prices for the Bedrock-hosted Claude models we use. Kept in
// lock-step with mcp-server/src/pricing.ts — the MCP server defines the schema,
// the portal is a first-party consumer of the same contract.
//
// We don't pull from the AWS pricing API per call because (a) rates move once a
// quarter at most and (b) we don't want a single bad pricing-API response to
// gate every CR's AI step.

export type ModelPricing = {
  inputUSDPer1M: number;
  outputUSDPer1M: number;
  cacheReadUSDPer1M: number;
  cacheWriteUSDPer1M: number;
};

export const PRICING: Record<string, ModelPricing> = {
  "eu.anthropic.claude-opus-4-6-v1": {
    inputUSDPer1M: 15.0,
    outputUSDPer1M: 75.0,
    cacheReadUSDPer1M: 1.5,
    cacheWriteUSDPer1M: 18.75,
  },
  "eu.anthropic.claude-sonnet-4-6-v1": {
    inputUSDPer1M: 3.0,
    outputUSDPer1M: 15.0,
    cacheReadUSDPer1M: 0.3,
    cacheWriteUSDPer1M: 3.75,
  },
  "eu.anthropic.claude-haiku-4-5-v1": {
    inputUSDPer1M: 1.0,
    outputUSDPer1M: 5.0,
    cacheReadUSDPer1M: 0.1,
    cacheWriteUSDPer1M: 1.25,
  },
};

export function computeCostUSD(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
): number {
  const p = PRICING[model];
  if (!p) return Number.NaN;
  // Uncached input tokens — when a portion was cache-read, only the remainder
  // is billed at the full input rate.
  const uncachedInput = Math.max(
    0,
    usage.inputTokens - (usage.cacheReadTokens ?? 0),
  );
  const usd = (tokens: number, ratePer1M: number) =>
    (tokens / 1_000_000) * ratePer1M;
  return (
    usd(uncachedInput, p.inputUSDPer1M) +
    usd(usage.outputTokens, p.outputUSDPer1M) +
    usd(usage.cacheReadTokens ?? 0, p.cacheReadUSDPer1M) +
    usd(usage.cacheWriteTokens ?? 0, p.cacheWriteUSDPer1M)
  );
}
