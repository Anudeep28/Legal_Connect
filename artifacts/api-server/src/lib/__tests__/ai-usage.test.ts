import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://usage-test:usage-test@127.0.0.1:1/usage_test";
const { estimateDeepSeekCostUsd } = await import("../ai-usage");

test("DeepSeek cost is estimated only from exact token usage and both configured rates", () => {
  const cost = estimateDeepSeekCostUsd(
    { inputTokens: 1_000_000, outputTokens: 500_000 },
    {
      DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS: "0.10",
      DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS: "0.20",
    },
  );
  assert.equal(cost, 0.2);
});

test("DeepSeek cost stays unavailable if usage or either rate is missing or invalid", () => {
  const usage = { inputTokens: 10_000, outputTokens: 2_000 };
  assert.equal(estimateDeepSeekCostUsd(usage, {}), null);
  assert.equal(estimateDeepSeekCostUsd(usage, {
    DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS: "0.10",
  }), null);
  assert.equal(estimateDeepSeekCostUsd(usage, {
    DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS: "0.10",
    DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS: "-0.20",
  }), null);
  assert.equal(estimateDeepSeekCostUsd(null, {
    DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS: "0.10",
    DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS: "0.20",
  }), null);
  assert.equal(estimateDeepSeekCostUsd({ inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 }, {
    DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS: "0.10",
    DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS: "0.20",
  }), null);
});
