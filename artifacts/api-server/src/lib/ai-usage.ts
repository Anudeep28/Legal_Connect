import { and, asc, desc, eq, gte, lte, lt, sql } from "drizzle-orm";
import { db, accounts, aiUsage, aiUsageDaily, lawyers } from "@workspace/db";
import { HttpError } from "../middlewares/access";
import { logger } from "./logger";
import { getAdminAiUsageBudgetState, notifyAiUsageBudgetAlertsSafely } from "./ai-usage-budget";
import { getAiUsageLimitsState } from "./ai-usage-limits";
import type { AiPlan } from "./ai-usage-limits";

type Kind = "drafting" | "transcription";
type Env = Record<string, string | undefined>;
export type { AiPlan } from "./ai-usage-limits";
export { aiDailyLimit } from "./ai-usage-limits";
export const AI_USAGE_RETENTION_DAYS = 90;
export const AI_USAGE_HISTORY_MAX_DAYS = 90;

function providerForKind(kind: Kind): "deepseek" | "elevenlabs" {
  return kind === "drafting" ? "deepseek" : "elevenlabs";
}

function configuredRate(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+(?:\.\d{1,9})?$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100_000 ? value : null;
}

export function estimateDeepSeekCostUsd(
  usage: { inputTokens: number; outputTokens: number } | null,
  env: Env = process.env,
): number | null {
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 ||
      !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) return null;
  const inputRate = configuredRate(env.DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS);
  const outputRate = configuredRate(env.DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS);
  if (inputRate === null || outputRate === null) return null;
  const cost = (usage.inputTokens * inputRate + usage.outputTokens * outputRate) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}

export function resolveAiPlan(
  account: Pick<typeof accounts.$inferSelect, "subscriptionPlan" | "subscriptionExpiresAt" | "documentCredits">,
  now = new Date(),
): AiPlan {
  const nowMs = now.getTime();
  if (account.subscriptionPlan === "monthly" && account.subscriptionExpiresAt &&
      Number.isFinite(Date.parse(account.subscriptionExpiresAt)) && Date.parse(account.subscriptionExpiresAt) > nowMs)
    return "monthly";
  if (account.documentCredits > 0) return "single";
  return "trial";
}

export function aiUsageWindow(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const resetsAt = new Date(`${day}T00:00:00.000Z`);
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return { day, resetsAt: resetsAt.toISOString() };
}

export async function getAiUsage(accountId: string, now = new Date()) {
  const { day, resetsAt } = aiUsageWindow(now);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) throw new HttpError(404, "Account not found.");
  const plan = resolveAiPlan(account, now);
  const [rows, limits] = await Promise.all([
    db.select().from(aiUsage).where(and(eq(aiUsage.accountId, accountId), eq(aiUsage.day, day))),
    getAiUsageLimitsState(),
  ]);
  const allowance = (kind: Kind) => {
    const limit = limits[kind][plan];
    const used = rows.find(row => row.kind === kind)?.used ?? 0;
    return { limit, used, remaining: Math.max(0, limit - used) };
  };
  return { plan, drafting: allowance("drafting"), transcription: allowance("transcription"), resetsAt };
}

export async function getAiUsageHistory(accountId: string, days = 30, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > AI_USAGE_HISTORY_MAX_DAYS)
    throw new HttpError(400, "Choose a history period from 1 to 90 days.");

  const today = aiUsageWindow(now).day;
  const firstDayDate = new Date(`${today}T00:00:00.000Z`);
  firstDayDate.setUTCDate(firstDayDate.getUTCDate() - days + 1);
  const firstDay = firstDayDate.toISOString().slice(0, 10);
  const rows = await db.select({
    day: aiUsage.day,
    kind: aiUsage.kind,
    requests: aiUsage.used,
    plans: aiUsage.plans,
    planHistoryComplete: aiUsage.planHistoryComplete,
  }).from(aiUsage).where(and(
    eq(aiUsage.accountId, accountId),
    gte(aiUsage.day, firstDay),
    lte(aiUsage.day, today),
  )).orderBy(desc(aiUsage.day));

  const history = new Map<string, {
    day: string;
    plans: Set<AiPlan>;
    planHistoryComplete: boolean;
    draftingRequests: number;
    transcriptionRequests: number;
  }>();
  for (const row of rows) {
    const entry = history.get(row.day) ?? {
      day: row.day,
      plans: new Set<AiPlan>(),
      planHistoryComplete: true,
      draftingRequests: 0,
      transcriptionRequests: 0,
    };
    if (row.kind === "drafting") entry.draftingRequests = row.requests;
    else entry.transcriptionRequests = row.requests;
    for (const plan of row.plans) {
      if (plan === "trial" || plan === "single" || plan === "monthly") entry.plans.add(plan);
    }
    entry.planHistoryComplete &&= row.planHistoryComplete;
    history.set(row.day, entry);
  }

  return {
    days,
    retentionDays: AI_USAGE_RETENTION_DAYS,
    entries: [...history.values()]
      .sort((a, b) => b.day.localeCompare(a.day))
      .map((entry) => ({ ...entry, plans: [...entry.plans] })),
  };
}

// Atomic insert-or-increment: multiple processes share the same strict allowance.
// Charge immediately before provider invocation, never refund uncertain failures:
// a timeout can still have incurred provider charges.
export async function reserveAiAttempt(
  accountId: string,
  kind: Kind,
  now = new Date(),
  limitsConfigId = "platform",
) {
  const { day, resetsAt } = aiUsageWindow(now);
  return db.transaction(async (tx) => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, accountId)).for("update");
    if (!account) throw new HttpError(404, "Account not found.");
    const plan = resolveAiPlan(account, now);
    const limits = await getAiUsageLimitsState(tx, true, limitsConfigId);
    const limit = limits[kind][plan];
    const exhausted = () => new HttpError(429,
      `Your daily ${kind} limit (${limit} requests for the ${plan} plan) has been reached. It resets at ${resetsAt} (midnight UTC). Your document has not been changed.`);
    if (!limit) throw exhausted();
    const [reserved] = await tx.insert(aiUsage).values({
      accountId, kind, day, used: 1, plans: [plan], planHistoryComplete: true,
    })
      .onConflictDoUpdate({
        target: [aiUsage.accountId, aiUsage.kind, aiUsage.day],
        set: {
          used: sql`${aiUsage.used} + 1`,
          plans: sql`CASE WHEN ${aiUsage.plans} @> ARRAY[${plan}]::text[] THEN ${aiUsage.plans} ELSE array_append(${aiUsage.plans}, ${plan}) END`,
        },
        setWhere: lt(aiUsage.used, limit),
      }).returning({ used: aiUsage.used });
    if (!reserved) throw exhausted();
    await tx.insert(aiUsageDaily).values({
      accountId,
      provider: providerForKind(kind),
      day,
      requests: 1,
    }).onConflictDoUpdate({
      target: [aiUsageDaily.accountId, aiUsageDaily.provider, aiUsageDaily.day],
      set: { requests: sql`${aiUsageDaily.requests} + 1` },
    });
    return { used: reserved.used, limit, resetsAt };
  });
}

export async function recordAiProviderSuccess(
  accountId: string,
  kind: Kind,
  usage: { inputTokens: number; outputTokens: number } | null = null,
  now = new Date(),
  budgetConfigId = "platform",
): Promise<void> {
  const { day } = aiUsageWindow(now);
  const provider = providerForKind(kind);
  const cost = provider === "deepseek" ? estimateDeepSeekCostUsd(usage) : null;
  const values = {
    accountId,
    provider,
    day,
    successfulRequests: 1,
    tokenUsageRequests: usage ? 1 : 0,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    pricedRequests: cost === null ? 0 : 1,
    estimatedCostUsd: cost,
  };
  const set = {
    successfulRequests: sql`${aiUsageDaily.successfulRequests} + 1`,
    tokenUsageRequests: usage
      ? sql`${aiUsageDaily.tokenUsageRequests} + 1`
      : aiUsageDaily.tokenUsageRequests,
    inputTokens: usage
      ? sql`${aiUsageDaily.inputTokens} + ${usage.inputTokens}`
      : aiUsageDaily.inputTokens,
    outputTokens: usage
      ? sql`${aiUsageDaily.outputTokens} + ${usage.outputTokens}`
      : aiUsageDaily.outputTokens,
    pricedRequests: cost === null
      ? aiUsageDaily.pricedRequests
      : sql`${aiUsageDaily.pricedRequests} + 1`,
    estimatedCostUsd: cost === null
      ? aiUsageDaily.estimatedCostUsd
      : sql`coalesce(${aiUsageDaily.estimatedCostUsd}, 0) + ${cost}`,
  };
  await db.insert(aiUsageDaily).values(values).onConflictDoUpdate({
    target: [aiUsageDaily.accountId, aiUsageDaily.provider, aiUsageDaily.day],
    set,
  });
  if (cost !== null) await notifyAiUsageBudgetAlertsSafely(now, budgetConfigId);
}

export async function recordAiProviderSuccessSafely(
  accountId: string,
  kind: Kind,
  usage: { inputTokens: number; outputTokens: number } | null = null,
): Promise<void> {
  try {
    await recordAiProviderSuccess(accountId, kind, usage);
  } catch (error) {
    logger.warn({ name: error instanceof Error ? error.name : "UnknownError", provider: providerForKind(kind) },
      "AI usage totals could not be updated");
  }
}

export async function getAdminAiUsage(days: number, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - days + 1);
  const firstDay = start.toISOString().slice(0, 10);
  const [metrics, attempts] = await Promise.all([
    db.select({
      day: aiUsageDaily.day,
      lawyerId: accounts.id,
      lawyerName: sql<string>`coalesce(${lawyers.name}, ${accounts.name})`,
      provider: aiUsageDaily.provider,
      requests: aiUsageDaily.requests,
      successfulRequests: aiUsageDaily.successfulRequests,
      tokenUsageRequests: aiUsageDaily.tokenUsageRequests,
      inputTokens: aiUsageDaily.inputTokens,
      outputTokens: aiUsageDaily.outputTokens,
      pricedRequests: aiUsageDaily.pricedRequests,
      estimatedCostUsd: aiUsageDaily.estimatedCostUsd,
    }).from(aiUsageDaily)
      .innerJoin(accounts, eq(aiUsageDaily.accountId, accounts.id))
      .leftJoin(lawyers, eq(lawyers.ownerId, accounts.id))
      .where(and(gte(aiUsageDaily.day, firstDay), eq(accounts.role, "lawyer"))),
    db.select({
      day: aiUsage.day,
      lawyerId: accounts.id,
      lawyerName: sql<string>`coalesce(${lawyers.name}, ${accounts.name})`,
      kind: aiUsage.kind,
      requests: aiUsage.used,
    }).from(aiUsage)
      .innerJoin(accounts, eq(aiUsage.accountId, accounts.id))
      .leftJoin(lawyers, eq(lawyers.ownerId, accounts.id))
      .where(and(gte(aiUsage.day, firstDay), eq(accounts.role, "lawyer"))),
  ]);
  type ReportRow = {
    day: string;
    lawyerId: string;
    lawyerName: string;
    provider: "deepseek" | "elevenlabs";
    requests: number;
    successfulRequests: number;
    successfulRequestsKnown: boolean;
    tokenUsageRequests: number;
    inputTokens: number;
    outputTokens: number;
    pricedRequests: number;
    estimatedCostUsd: number | null;
  };
  const report = new Map<string, ReportRow>();
  const keyOf = (row: Pick<ReportRow, "day" | "lawyerId" | "provider">) =>
    `${row.day}:${row.lawyerId}:${row.provider}`;
  for (const metric of metrics) {
    const row: ReportRow = { ...metric, successfulRequestsKnown: true };
    report.set(keyOf(row), row);
  }
  for (const attempt of attempts) {
    const provider = providerForKind(attempt.kind);
    const key = keyOf({ day: attempt.day, lawyerId: attempt.lawyerId, provider });
    const existing = report.get(key);
    if (existing) {
      existing.requests = Math.max(existing.requests, attempt.requests);
      continue;
    }
    const row: ReportRow = {
      day: attempt.day,
      lawyerId: attempt.lawyerId,
      lawyerName: attempt.lawyerName,
      provider,
      requests: attempt.requests,
      successfulRequests: 0,
      successfulRequestsKnown: false,
      tokenUsageRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      pricedRequests: 0,
      estimatedCostUsd: null,
    };
    report.set(keyOf(row), row);
  }
  const rows = [...report.values()].sort((a, b) =>
    b.day.localeCompare(a.day) || a.lawyerName.localeCompare(b.lawyerName) || a.provider.localeCompare(b.provider));
  const [monthlyBudget, dailyLimits] = await Promise.all([
    getAdminAiUsageBudgetState(now),
    getAiUsageLimitsState(),
  ]);
  return { days, retentionDays: AI_USAGE_RETENTION_DAYS, monthlyBudget, dailyLimits, rows };
}

export async function pruneAiUsageData(now = new Date()): Promise<void> {
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() - AI_USAGE_RETENTION_DAYS);
  const beforeDay = cutoff.toISOString().slice(0, 10);
  await db.delete(aiUsageDaily).where(lt(aiUsageDaily.day, beforeDay));
  await db.delete(aiUsage).where(lt(aiUsage.day, beforeDay));
}

export function startAiUsageRetentionWorker() {
  const tick = () => {
    void pruneAiUsageData().catch(() => logger.warn("AI usage retention cleanup failed"));
  };
  tick();
  const timer = setInterval(tick, 24 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
