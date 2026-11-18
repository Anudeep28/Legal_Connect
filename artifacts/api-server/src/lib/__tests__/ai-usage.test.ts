import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://usage-test:usage-test@127.0.0.1:1/usage_test";
const { aiDailyLimit, estimateDeepSeekCostUsd, resolveAiPlan } = await import("../ai-usage");

test("daily AI limits differ by plan and support per-plan and legacy overrides", () => {
  assert.equal(aiDailyLimit("drafting", "trial", {}), 5);
  assert.equal(aiDailyLimit("drafting", "single", {}), 15);
  assert.equal(aiDailyLimit("drafting", "monthly", {}), 30);
  assert.equal(aiDailyLimit("transcription", "trial", {}), 5);
  assert.equal(aiDailyLimit("transcription", "single", {}), 15);
  assert.equal(aiDailyLimit("transcription", "monthly", {}), 30);
  assert.equal(aiDailyLimit("drafting", "trial", {
    AI_DRAFTING_DAILY_LIMIT: "8",
  }), 5);
  assert.equal(aiDailyLimit("drafting", "trial", {
    AI_DRAFTING_DAILY_LIMIT_TRIAL: "3",
    AI_DRAFTING_DAILY_LIMIT: "8",
  }), 3);
  assert.equal(aiDailyLimit("drafting", "monthly", {
    AI_DRAFTING_DAILY_LIMIT: "8",
  }), 8);
  assert.throws(() => aiDailyLimit("drafting", "trial", {
    AI_DRAFTING_DAILY_LIMIT_TRIAL: "not-a-number",
  }), /misconfigured/i);
});

test("effective AI plan follows active monthly access, then available credits", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");
  assert.equal(resolveAiPlan({
    subscriptionPlan: "monthly",
    subscriptionExpiresAt: "2026-11-20T12:00:00.000Z",
    documentCredits: 0,
  }, now), "monthly");
  assert.equal(resolveAiPlan({
    subscriptionPlan: "monthly",
    subscriptionExpiresAt: "2026-11-17T12:00:00.000Z",
    documentCredits: 1,
  }, now), "single");
  assert.equal(resolveAiPlan({
    subscriptionPlan: "monthly",
    subscriptionExpiresAt: "2026-11-17T12:00:00.000Z",
    documentCredits: 0,
  }, now), "trial");
});

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
