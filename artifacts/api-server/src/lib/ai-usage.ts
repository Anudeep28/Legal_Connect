import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, accounts, aiUsage, aiUsageDaily, lawyers } from "@workspace/db";
import { HttpError } from "../middlewares/access";
import { logger } from "./logger";

type Kind = "drafting" | "transcription";
type Env = Record<string, string | undefined>;
export const AI_USAGE_RETENTION_DAYS = 90;

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

export function aiDailyLimit(kind: Kind, env: Env = process.env): number {
  const key = kind === "drafting" ? "AI_DRAFTING_DAILY_LIMIT" : "AI_TRANSCRIPTION_DAILY_LIMIT";
  const raw = env[key];
  if (raw === undefined) return 30;
  if (!/^\d+$/.test(raw) || Number(raw) > 10000) {
    throw new HttpError(503, "AI usage limits are misconfigured. Please contact the administrator.");
  }
  return Number(raw);
}

export function aiUsageWindow(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const resetsAt = new Date(`${day}T00:00:00.000Z`);
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return { day, resetsAt: resetsAt.toISOString() };
}

export async function getAiUsage(accountId: string, now = new Date()) {
  const { day, resetsAt } = aiUsageWindow(now);
  const rows = await db.select().from(aiUsage).where(and(eq(aiUsage.accountId, accountId), eq(aiUsage.day, day)));
  const allowance = (kind: Kind) => {
    const limit = aiDailyLimit(kind);
    const used = rows.find(row => row.kind === kind)?.used ?? 0;
    return { limit, used, remaining: Math.max(0, limit - used) };
  };
  return { drafting: allowance("drafting"), transcription: allowance("transcription"), resetsAt };
}

// Atomic insert-or-increment: multiple processes share the same strict allowance.
// Charge immediately before provider invocation, never refund uncertain failures:
// a timeout can still have incurred provider charges.
export async function reserveAiAttempt(accountId: string, kind: Kind, now = new Date()) {
  const { day, resetsAt } = aiUsageWindow(now);
  const limit = aiDailyLimit(kind);
  const exhausted = () => new HttpError(429,
    `Your daily ${kind} limit (${limit} requests) has been reached. It resets at ${resetsAt} (midnight UTC). Your document has not been changed.`);
  if (!limit) throw exhausted();
  return db.transaction(async (tx) => {
    const [reserved] = await tx.insert(aiUsage).values({ accountId, kind, day, used: 1 })
      .onConflictDoUpdate({
        target: [aiUsage.accountId, aiUsage.kind, aiUsage.day],
        set: { used: sql`${aiUsage.used} + 1` },
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
  return { days, retentionDays: AI_USAGE_RETENTION_DAYS, rows };
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
