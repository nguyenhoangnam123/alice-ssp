// Per-1M-token USD prices for Bedrock-hosted models we use. Static table — we'd
// pull from the Bedrock pricing API only if these started moving more than once
// a quarter. Numbers below are from the AWS Bedrock public pricing page for
// eu-west-1 (cross-region inference profile for Claude models).
//
// cache_read is the *discounted* read rate when a cache hit lands on a previously
// written ephemeral cache block — typically 10% of the input rate for Claude.

export type ModelPricing = {
  /** USD per 1M tokens charged for prompt tokens (uncached). */
  inputUSDPer1M: number;
  /** USD per 1M tokens charged for completion tokens. */
  outputUSDPer1M: number;
  /** USD per 1M tokens charged for prompt tokens that hit the cache. */
  cacheReadUSDPer1M: number;
  /** USD per 1M tokens charged when writing the prompt to the cache. */
  cacheWriteUSDPer1M: number;
};

export const PRICING: Record<string, ModelPricing> = {
  // Claude Opus 4.6 via EU cross-region inference profile.
  "eu.anthropic.claude-opus-4-6-v1": {
    inputUSDPer1M: 15.0,
    outputUSDPer1M: 75.0,
    cacheReadUSDPer1M: 1.5,
    cacheWriteUSDPer1M: 18.75,
  },
  // Sonnet 4.6.
  "eu.anthropic.claude-sonnet-4-6-v1": {
    inputUSDPer1M: 3.0,
    outputUSDPer1M: 15.0,
    cacheReadUSDPer1M: 0.3,
    cacheWriteUSDPer1M: 3.75,
  },
  // Haiku 4.5.
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
  if (!p) {
    // Unknown model — we still log usage but cost can't be computed. Caller decides
    // whether that's an error (it should be: a CR using an unknown model means our
    // model allowlist drifted).
    return Number.NaN;
  }
  const uncachedInput = Math.max(
    0,
    usage.inputTokens - (usage.cacheReadTokens ?? 0),
  );
  const tokensToUSD = (tokens: number, ratePer1M: number) =>
    (tokens / 1_000_000) * ratePer1M;
  return (
    tokensToUSD(uncachedInput, p.inputUSDPer1M) +
    tokensToUSD(usage.outputTokens, p.outputUSDPer1M) +
    tokensToUSD(usage.cacheReadTokens ?? 0, p.cacheReadUSDPer1M) +
    tokensToUSD(usage.cacheWriteTokens ?? 0, p.cacheWriteUSDPer1M)
  );
}
