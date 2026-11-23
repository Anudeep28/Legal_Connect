import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://usage-test:usage-test@127.0.0.1:1/usage_test";
const {
  aiDailyLimit,
  estimateDeepSeekCostUsd,
  getAdminAiUsage,
  getAiUsageHistory,
  recordAiProviderSuccess,
  reserveAiAttempt,
  resolveAiPlan,
} = await import("../ai-usage");
const {
  getAdminAiUsageBudgetState,
  notifyAiUsageBudgetAlerts,
  saveAdminAiUsageBudgetConfig,
} = await import("../ai-usage-budget");
const { GetAdminAiUsageResponse } = await import("@workspace/api-zod");
const { accounts, aiUsage, aiUsageBudget, aiUsageDaily, auditLogs, db, notifications, pool } = await import("@workspace/db");

const prefix = `ai-spend-alert-${randomUUID()}`;
const ownerId = `${prefix}-owner`;
const pricedLawyerId = `${prefix}-priced-lawyer`;
const unpricedLawyerId = `${prefix}-unpriced-lawyer`;
const pricedConfigId = `${prefix}-priced-config`;
const unpricedConfigId = `${prefix}-unpriced-config`;
const pricedNow = new Date("2096-11-18T12:00:00.000Z");
const unpricedNow = new Date("2096-12-18T12:00:00.000Z");

before(async () => {
  await db.insert(accounts).values([
    { id: ownerId, name: "Synthetic AI budget owner", email: `${ownerId}@example.com`, role: "admin" },
    { id: pricedLawyerId, name: "Synthetic priced lawyer", email: `${pricedLawyerId}@example.com`, role: "lawyer" },
    { id: unpricedLawyerId, name: "Synthetic unpriced lawyer", email: `${unpricedLawyerId}@example.com`, role: "lawyer" },
  ]);
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorId: ownerId,
    targetId: ownerId,
    action: "admin:owner-designated",
    reason: "Synthetic AI spend alert fixture",
  });
});

after(async () => {
  await db.delete(notifications).where(eq(notifications.userId, ownerId));
  await db.delete(aiUsageBudget).where(inArray(aiUsageBudget.id, [pricedConfigId, unpricedConfigId]));
  await db.delete(aiUsageDaily).where(inArray(aiUsageDaily.accountId, [pricedLawyerId, unpricedLawyerId]));
  await db.delete(auditLogs).where(eq(auditLogs.actorId, ownerId));
  await db.delete(accounts).where(inArray(accounts.id, [ownerId, pricedLawyerId, unpricedLawyerId]));
  await pool.end();
});

async function insertUsageRow(
  accountId: string,
  provider: "deepseek" | "elevenlabs",
  day: string,
  requests: number,
  pricedRequests: number,
  estimatedCostUsd: number | null,
) {
  await db.insert(aiUsageDaily).values({
    accountId,
    provider,
    day,
    requests,
    successfulRequests: requests,
    tokenUsageRequests: provider === "deepseek" ? pricedRequests : 0,
    inputTokens: provider === "deepseek" ? pricedRequests * 1000 : 0,
    outputTokens: provider === "deepseek" ? pricedRequests * 500 : 0,
    pricedRequests,
    estimatedCostUsd,
  });
}

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

test("usage attempts record every plan applied during a day", async () => {
  const firstRequestAt = new Date("2096-11-19T10:00:00.000Z");
  const secondRequestAt = new Date("2096-11-19T14:00:00.000Z");
  try {
    await db.update(accounts).set({
      documentCredits: 1,
      subscriptionPlan: "trial",
      subscriptionExpiresAt: null,
    }).where(eq(accounts.id, unpricedLawyerId));
    await reserveAiAttempt(unpricedLawyerId, "drafting", firstRequestAt);

    await db.update(accounts).set({
      documentCredits: 0,
      subscriptionPlan: "monthly",
      subscriptionExpiresAt: "2096-11-20T00:00:00.000Z",
    }).where(eq(accounts.id, unpricedLawyerId));
    await reserveAiAttempt(unpricedLawyerId, "drafting", secondRequestAt);

    const [usage] = await db.select().from(aiUsage).where(and(
      eq(aiUsage.accountId, unpricedLawyerId),
      eq(aiUsage.kind, "drafting"),
      eq(aiUsage.day, "2096-11-19"),
    ));
    assert.equal(usage?.used, 2);
    assert.deepEqual(usage?.plans, ["single", "monthly"]);
    assert.equal(usage?.planHistoryComplete, true);
  } finally {
    await db.delete(aiUsage).where(and(
      eq(aiUsage.accountId, unpricedLawyerId),
      eq(aiUsage.day, "2096-11-19"),
    ));
    await db.delete(aiUsageDaily).where(and(
      eq(aiUsageDaily.accountId, unpricedLawyerId),
      eq(aiUsageDaily.day, "2096-11-19"),
    ));
  }
});

test("lawyer AI history is account-scoped, separates request types, and reports plan snapshots", async () => {
  const today = "2096-11-18";
  const yesterday = "2096-11-17";
  await db.insert(aiUsage).values([
    { accountId: pricedLawyerId, kind: "drafting", day: today, used: 3, plans: ["single"], planHistoryComplete: true },
    { accountId: pricedLawyerId, kind: "transcription", day: today, used: 2, plans: ["single", "monthly"], planHistoryComplete: true },
    { accountId: pricedLawyerId, kind: "drafting", day: yesterday, used: 4, plans: [], planHistoryComplete: false },
    { accountId: unpricedLawyerId, kind: "drafting", day: today, used: 99, plans: ["monthly"], planHistoryComplete: true },
  ]);

  const history = await getAiUsageHistory(pricedLawyerId, 7, new Date(`${today}T12:00:00.000Z`));
  assert.equal(history.days, 7);
  assert.equal(history.retentionDays, 90);
  assert.deepEqual(history.entries, [
    {
      day: today,
      plans: ["single", "monthly"],
      planHistoryComplete: true,
      draftingRequests: 3,
      transcriptionRequests: 2,
    },
    {
      day: yesterday,
      plans: [],
      planHistoryComplete: false,
      draftingRequests: 4,
      transcriptionRequests: 0,
    },
  ]);
  assert.equal("accountId" in history.entries[0]!, false);
  await assert.rejects(getAiUsageHistory(pricedLawyerId, 91), /1 to 90 days/i);
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

test("monthly AI alerts use known estimates, disclose partial coverage, and deduplicate by month", async () => {
  await saveAdminAiUsageBudgetConfig({
    enabled: true,
    monthlyBudgetUsd: 10,
    warningPercent: 80,
  }, ownerId, pricedNow, pricedConfigId);
  await insertUsageRow(pricedLawyerId, "deepseek", "2096-11-18", 2, 0, null);
  await insertUsageRow(pricedLawyerId, "elevenlabs", "2096-11-04", 3, 0, null);

  const oldInputRate = process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS;
  const oldOutputRate = process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS;
  process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS = "1";
  process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS = "0";
  try {
    await recordAiProviderSuccess(pricedLawyerId, "drafting", {
      inputTokens: 8_250_000,
      outputTokens: 0,
    }, pricedNow, pricedConfigId);
  } finally {
    if (oldInputRate === undefined) delete process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS;
    else process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS = oldInputRate;
    if (oldOutputRate === undefined) delete process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS;
    else process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS = oldOutputRate;
  }
  let state = await getAdminAiUsageBudgetState(pricedNow, pricedConfigId);
  assert.equal(state.currentMonthEstimatedUsd, 8.25);
  assert.equal(state.costCoverage, "partial");
  assert.equal(state.requests, 5);
  assert.equal(state.pricedRequests, 1);
  assert.equal(state.alertLevel, "approaching");

  let alerts = await db.select().from(notifications)
    .where(like(notifications.eventKey, `ai-usage-budget:${pricedConfigId}:%`));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0]!.body, /at least/);
  assert.match(alerts[0]!.body, /not counted as zero/);
  assert.match(alerts[0]!.body, /not a provider invoice or a spending cap/);

  const inputRate = process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS;
  const outputRate = process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS;
  process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS = "1";
  process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS = "0";
  try {
    await recordAiProviderSuccess(pricedLawyerId, "drafting", {
      inputTokens: 3_250_000,
      outputTokens: 0,
    }, pricedNow, pricedConfigId);
  } finally {
    if (inputRate === undefined) delete process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS;
    else process.env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS = inputRate;
    if (outputRate === undefined) delete process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS;
    else process.env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS = outputRate;
  }
  await notifyAiUsageBudgetAlerts(pricedNow, pricedConfigId);
  await notifyAiUsageBudgetAlerts(pricedNow, pricedConfigId);
  state = await getAdminAiUsageBudgetState(pricedNow, pricedConfigId);
  assert.equal(state.currentMonthEstimatedUsd, 11.5);
  assert.equal(state.costCoverage, "partial");
  assert.equal(state.alertLevel, "reached");

  alerts = await db.select().from(notifications)
    .where(like(notifications.eventKey, `ai-usage-budget:${pricedConfigId}:%`));
  assert.equal(alerts.length, 2, "one warning and one reached alert are created, without duplicates");
});

test("unpriced AI requests stay unavailable rather than becoming zero spend", async () => {
  await saveAdminAiUsageBudgetConfig({
    enabled: true,
    monthlyBudgetUsd: 1,
    warningPercent: 50,
  }, ownerId, unpricedNow, unpricedConfigId);
  await insertUsageRow(unpricedLawyerId, "elevenlabs", "2096-12-03", 2, 0, null);
  await notifyAiUsageBudgetAlerts(unpricedNow, unpricedConfigId);

  const state = await getAdminAiUsageBudgetState(unpricedNow, unpricedConfigId);
  assert.equal(state.currentMonthEstimatedUsd, null);
  assert.equal(state.costCoverage, "unavailable");
  assert.equal(state.alertLevel, "none");
  assert.equal(state.requests, 2);
  assert.equal(state.pricedRequests, 0);

  const report = GetAdminAiUsageResponse.parse(await getAdminAiUsage(30, unpricedNow));
  assert.equal(report.monthlyBudget.currentMonthEstimatedUsd, null);
  assert.equal(report.monthlyBudget.costCoverage, "unavailable");
  assert.equal(report.monthlyBudget.alertLevel, "none");
  const alerts = await db.select().from(notifications)
    .where(like(notifications.eventKey, `ai-usage-budget:${unpricedConfigId}:%`));
  assert.equal(alerts.length, 0);
});

test("AI monthly alert settings reject invalid warning and missing enabled thresholds", async () => {
  await assert.rejects(() => saveAdminAiUsageBudgetConfig({
    enabled: true,
    monthlyBudgetUsd: null,
    warningPercent: 80,
  }, ownerId, pricedNow, `${prefix}-missing-threshold`), /positive monthly threshold/i);
  await assert.rejects(() => saveAdminAiUsageBudgetConfig({
    enabled: false,
    monthlyBudgetUsd: 10,
    warningPercent: 100,
  }, ownerId, pricedNow, `${prefix}-bad-percent`), /between 50% and 95%/i);
});
