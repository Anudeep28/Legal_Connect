import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { accounts, aiUsageBudget, aiUsageDaily, auditLogs, db, notifications } from "@workspace/db";
import { HttpError } from "../middlewares/access";
import { logger } from "./logger";

const CONFIG_ID = "platform";

export type AiUsageCostCoverage = "no_usage" | "unavailable" | "partial" | "complete";
export type AiUsageAlertLevel = "none" | "approaching" | "reached";

export type AdminAiUsageBudgetState = {
  enabled: boolean;
  monthlyBudgetUsd: number | null;
  warningPercent: number;
  monthStart: string;
  currentMonthEstimatedUsd: number | null;
  costCoverage: AiUsageCostCoverage;
  requests: number;
  pricedRequests: number;
  alertLevel: AiUsageAlertLevel;
};

function monthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function nextMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

function alertLevelFor(
  enabled: boolean,
  budget: number | null,
  warningPercent: number,
  spend: number | null,
): AiUsageAlertLevel {
  if (!enabled || budget === null || !Number.isFinite(budget) || budget <= 0 ||
      spend === null || !Number.isFinite(spend)) return "none";
  if (spend >= budget) return "reached";
  return spend >= budget * warningPercent / 100 ? "approaching" : "none";
}

function stateFromRows(
  config: typeof aiUsageBudget.$inferSelect | undefined,
  rows: Array<Pick<typeof aiUsageDaily.$inferSelect, "requests" | "pricedRequests" | "estimatedCostUsd">>,
  now: Date,
): AdminAiUsageBudgetState {
  const requests = rows.reduce((sum, row) => sum + Math.max(0, row.requests, row.pricedRequests), 0);
  const pricedRows = rows.filter((row) => row.estimatedCostUsd !== null && row.pricedRequests > 0);
  const pricedRequests = pricedRows.reduce((sum, row) => sum + Math.max(0, row.pricedRequests), 0);
  const knownSpend = pricedRows.reduce((sum, row) => sum + Number(row.estimatedCostUsd), 0);
  const costCoverage: AiUsageCostCoverage = requests === 0
    ? "no_usage"
    : pricedRequests === 0
      ? "unavailable"
      : pricedRequests < requests
        ? "partial"
        : "complete";
  const currentMonthEstimatedUsd = pricedRequests > 0 && Number.isFinite(knownSpend) ? knownSpend : null;
  const monthlyBudgetUsd = config?.monthlyBudgetUsd ?? null;
  const warningPercent = config?.warningPercent ?? 80;

  return {
    enabled: config?.enabled ?? false,
    monthlyBudgetUsd,
    warningPercent,
    monthStart: monthStart(now),
    currentMonthEstimatedUsd,
    costCoverage,
    requests,
    pricedRequests,
    alertLevel: alertLevelFor(config?.enabled ?? false, monthlyBudgetUsd, warningPercent, currentMonthEstimatedUsd),
  };
}

async function getMonthRows(query: Pick<typeof db, "select">, now: Date) {
  return query.select({
    requests: aiUsageDaily.requests,
    pricedRequests: aiUsageDaily.pricedRequests,
    estimatedCostUsd: aiUsageDaily.estimatedCostUsd,
  }).from(aiUsageDaily)
    .innerJoin(accounts, eq(aiUsageDaily.accountId, accounts.id))
    .where(and(
      eq(accounts.role, "lawyer"),
      gte(aiUsageDaily.day, monthStart(now)),
      lt(aiUsageDaily.day, nextMonthStart(now)),
    ));
}

export async function getAdminAiUsageBudgetState(now = new Date(), configId = CONFIG_ID): Promise<AdminAiUsageBudgetState> {
  const [[config], rows] = await Promise.all([
    db.select().from(aiUsageBudget).where(eq(aiUsageBudget.id, configId)).limit(1),
    getMonthRows(db, now),
  ]);
  return stateFromRows(config, rows, now);
}

async function ownerCanReceiveAlert(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ownerId: string | null,
) {
  if (!ownerId) return false;
  const [owner] = await tx.select({ role: accounts.role, status: accounts.status })
    .from(accounts).where(eq(accounts.id, ownerId)).limit(1);
  if (owner?.role !== "admin" || owner.status !== "active") return false;
  const [grant] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
    eq(auditLogs.actorId, ownerId),
    eq(auditLogs.targetId, ownerId),
    eq(auditLogs.action, "admin:owner-designated"),
  )).limit(1);
  return Boolean(grant);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export async function notifyAiUsageBudgetAlerts(now = new Date(), configId = CONFIG_ID): Promise<void> {
  const candidate = await getAdminAiUsageBudgetState(now, configId);
  if (candidate.alertLevel === "none" || candidate.currentMonthEstimatedUsd === null ||
      candidate.monthlyBudgetUsd === null) return;
  const eventKeys = [
    ...(candidate.currentMonthEstimatedUsd >= candidate.monthlyBudgetUsd * candidate.warningPercent / 100
      ? [`ai-usage-budget:${configId}:${candidate.monthStart}:approaching`] : []),
    ...(candidate.currentMonthEstimatedUsd >= candidate.monthlyBudgetUsd
      ? [`ai-usage-budget:${configId}:${candidate.monthStart}:reached`] : []),
  ];
  const existing = await db.select({ eventKey: notifications.eventKey }).from(notifications)
    .where(inArray(notifications.eventKey, eventKeys));
  if (eventKeys.every((eventKey) => existing.some((row) => row.eventKey === eventKey))) return;

  await db.transaction(async (tx) => {
    const [config] = await tx.select().from(aiUsageBudget)
      .where(eq(aiUsageBudget.id, configId)).for("update").limit(1);
    if (!config?.enabled || config.monthlyBudgetUsd === null || config.monthlyBudgetUsd <= 0) return;

    const rows = await getMonthRows(tx, now);
    const state = stateFromRows(config, rows, now);
    if (state.alertLevel === "none" || state.currentMonthEstimatedUsd === null ||
        !await ownerCanReceiveAlert(tx, config.configuredBy)) return;

    const levels = [
      ...(state.currentMonthEstimatedUsd >= config.monthlyBudgetUsd * config.warningPercent / 100
        ? [{ level: "approaching" as const, percent: config.warningPercent }] : []),
      ...(state.currentMonthEstimatedUsd >= config.monthlyBudgetUsd
        ? [{ level: "reached" as const, percent: 100 }] : []),
    ];
    const estimateText = state.costCoverage === "partial"
      ? `Recorded, rate-backed AI cost estimates are at least ${money(state.currentMonthEstimatedUsd)} of your ${money(config.monthlyBudgetUsd)} monthly threshold. Some request costs are unavailable and are not counted as zero, so actual spend may be higher.`
      : `Recorded, rate-backed AI cost estimates are ${money(state.currentMonthEstimatedUsd)} of your ${money(config.monthlyBudgetUsd)} monthly threshold.`;

    for (const alert of levels) {
      await tx.insert(notifications).values({
        id: randomUUID(),
        userId: config.configuredBy!,
        eventKey: `ai-usage-budget:${configId}:${state.monthStart}:${alert.level}`,
        title: alert.level === "reached"
          ? "AI usage estimate reached the monthly threshold"
          : `AI usage estimate reached ${alert.percent}% of the monthly threshold`,
        body: `${estimateText} This is an estimate, not a provider invoice or a spending cap; lawyer requests continue.`,
        link: "/admin",
      }).onConflictDoNothing();
    }
  });
}

export async function notifyAiUsageBudgetAlertsSafely(now = new Date(), configId = CONFIG_ID): Promise<void> {
  try {
    await notifyAiUsageBudgetAlerts(now, configId);
  } catch (error) {
    logger.warn({ name: error instanceof Error ? error.name : "UnknownError" },
      "AI spend alert could not be saved");
  }
}

export async function saveAdminAiUsageBudgetConfig(
  input: { enabled: boolean; monthlyBudgetUsd: number | null; warningPercent: number },
  ownerId: string,
  now = new Date(),
  configId = CONFIG_ID,
): Promise<AdminAiUsageBudgetState> {
  if (!Number.isInteger(input.warningPercent) || input.warningPercent < 50 || input.warningPercent > 95)
    throw new HttpError(400, "Choose a warning threshold between 50% and 95%.");
  if (input.monthlyBudgetUsd !== null &&
      (!Number.isFinite(input.monthlyBudgetUsd) || input.monthlyBudgetUsd < 0.01 || input.monthlyBudgetUsd > 1_000_000_000))
    throw new HttpError(400, "Enter a monthly threshold from $0.01 to $1,000,000,000.");
  if (input.enabled && (input.monthlyBudgetUsd === null || input.monthlyBudgetUsd <= 0))
    throw new HttpError(400, "Enter a positive monthly threshold before enabling alerts.");

  await db.insert(aiUsageBudget).values({
    id: configId,
    enabled: input.enabled,
    monthlyBudgetUsd: input.monthlyBudgetUsd,
    warningPercent: input.warningPercent,
    configuredBy: ownerId,
  }).onConflictDoUpdate({
    target: aiUsageBudget.id,
    set: {
      enabled: input.enabled,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      warningPercent: input.warningPercent,
      configuredBy: ownerId,
      updatedAt: now.toISOString(),
    },
  });
  await notifyAiUsageBudgetAlertsSafely(now, configId);
  return getAdminAiUsageBudgetState(now, configId);
}
