import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  accounts,
  auditLogs,
  db,
  notifications,
  twilioUsageBudget,
  twilioUsageHistory,
  type TwilioUsageBudget,
} from "@workspace/db";
import { twilioUsageLookupConfigured } from "./communication-config";
import { getTwilioVideoUsage } from "./consultation-calls";
import { logger } from "./logger";

const CONFIG_ID = "platform";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 15 * 60 * 1000;
const UNCONFIGURED_RETRY_MS = 15 * 60 * 1000;
const LOOKUP_LOCK_MS = 10 * 60 * 1000;
const USAGE_DELAY_WARNING_MS = 24 * 60 * 60 * 1000;

type RefreshOptions = {
  force?: boolean;
  ownerId?: string;
  configId?: string;
  now?: Date;
  fetchUsage?: typeof getTwilioVideoUsage;
};

function currentMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function currentMonthRange(now: Date) {
  return {
    start: currentMonthStart(now),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
  };
}

function amount(value: string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formattedMoney(value: number, currency: string) {
  return `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function alertLevelFor(row: TwilioUsageBudget, now: Date): "none" | "approaching" | "reached" {
  const spend = amount(row.currentSpend);
  const budget = amount(row.budgetAmount);
  if (!row.enabled || spend === null || budget === null || budget <= 0 ||
    !row.usageCurrency || row.usageCurrency !== row.budgetCurrency ||
    row.periodStart !== currentMonthStart(now)) return "none";
  if (spend >= budget) return "reached";
  return spend >= budget * row.warningPercent / 100 ? "approaching" : "none";
}

function stateView(row: TwilioUsageBudget | undefined, now: Date) {
  const spend = amount(row?.currentSpend ?? null);
  const usageCurrency = row?.usageCurrency ?? null;
  const budgetCurrency = row?.budgetCurrency ?? "USD";
  const usageAsOf = row?.usageAsOf ?? null;
  const dataDelayed = spend !== null &&
    (!usageAsOf || now.getTime() - new Date(usageAsOf).getTime() > USAGE_DELAY_WARNING_MS);
  return {
    enabled: row?.enabled ?? false,
    budgetAmount: amount(row?.budgetAmount ?? null),
    budgetCurrency,
    warningPercent: row?.warningPercent ?? 80,
    lookupStatus: row?.lookupStatus ?? "not_checked" as const,
    currentSpend: spend,
    usageCurrency,
    participantMinutes: amount(row?.participantMinutes ?? null),
    periodStart: row?.periodStart ?? null,
    periodEnd: row?.periodEnd ?? null,
    usageAsOf,
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    providerConfigured: twilioUsageLookupConfigured(),
    dataDelayed,
    currencyMatches: spend !== null && usageCurrency === budgetCurrency,
    periodCurrent: Boolean(row?.periodStart && row.periodStart === currentMonthStart(now)),
    alertLevel: row ? alertLevelFor(row, now) : "none" as const,
  };
}

export async function getTwilioUsageBudgetState(now = new Date(), configId = CONFIG_ID) {
  const [row] = await db.select().from(twilioUsageBudget).where(eq(twilioUsageBudget.id, configId)).limit(1);
  return stateView(row, now);
}

export async function getTwilioUsageHistory() {
  const rows = await db.select().from(twilioUsageHistory).orderBy(desc(twilioUsageHistory.periodStart));
  return {
    months: rows.map((row) => ({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      status: row.status,
      spend: amount(row.spend),
      currency: row.currency,
      participantMinutes: amount(row.participantMinutes),
      usageAsOf: row.usageAsOf ? new Date(row.usageAsOf).toISOString() : null,
      checkedAt: new Date(row.checkedAt).toISOString(),
    })),
  };
}

export async function saveTwilioUsageBudgetConfig(
  input: { enabled: boolean; budgetAmount: number | null; budgetCurrency: string; warningPercent: number },
  ownerId: string,
  now = new Date(),
  configId = CONFIG_ID,
) {
  if (input.enabled && (input.budgetAmount === null || input.budgetAmount <= 0))
    throw new Error("A positive monthly budget is required when alerts are enabled.");
  const nextCheckAt = now.toISOString();
  await db.insert(twilioUsageBudget).values({
    id: configId,
    enabled: input.enabled,
    budgetAmount: input.budgetAmount === null ? null : input.budgetAmount.toFixed(6),
    budgetCurrency: input.budgetCurrency.trim().toUpperCase(),
    warningPercent: input.warningPercent,
    nextCheckAt,
    configuredBy: ownerId,
  }).onConflictDoUpdate({
    target: twilioUsageBudget.id,
    set: {
      enabled: input.enabled,
      budgetAmount: input.budgetAmount === null ? null : input.budgetAmount.toFixed(6),
      budgetCurrency: input.budgetCurrency.trim().toUpperCase(),
      warningPercent: input.warningPercent,
      nextCheckAt,
      configuredBy: ownerId,
    },
  });
  return getTwilioUsageBudgetState(now, configId);
}

async function claimLookup(options: RefreshOptions, now: Date) {
  const configId = options.configId ?? CONFIG_ID;
  return db.transaction(async (tx) => {
    let [row] = await tx.select().from(twilioUsageBudget)
      .where(eq(twilioUsageBudget.id, configId)).for("update");
    if (!row && options.ownerId) {
      await tx.insert(twilioUsageBudget).values({
        id: configId,
        configuredBy: options.ownerId,
      }).onConflictDoNothing();
      [row] = await tx.select().from(twilioUsageBudget)
        .where(eq(twilioUsageBudget.id, configId)).for("update");
    }
    if (!row) return null;

    const lastAttempt = row.lastAttemptAt ? new Date(row.lastAttemptAt).getTime() : 0;
    const currentlyLocked = row.lookupStatus === "checking" && now.getTime() - lastAttempt < LOOKUP_LOCK_MS;
    if (currentlyLocked) return null;
    if (!options.force && row.nextCheckAt && new Date(row.nextCheckAt).getTime() > now.getTime())
      return null;

    const [claimed] = await tx.update(twilioUsageBudget).set({
      lookupStatus: "checking",
      lastAttemptAt: now.toISOString(),
      nextCheckAt: new Date(now.getTime() + LOOKUP_LOCK_MS).toISOString(),
    }).where(eq(twilioUsageBudget.id, configId)).returning();
    return claimed ?? null;
  });
}

async function finishFailedLookup(status: "failed" | "not_configured", now: Date, configId = CONFIG_ID) {
  const retryMs = status === "not_configured" ? UNCONFIGURED_RETRY_MS : RETRY_INTERVAL_MS;
  await db.update(twilioUsageBudget).set({
    lookupStatus: status,
    lastAttemptAt: now.toISOString(),
    nextCheckAt: new Date(now.getTime() + retryMs).toISOString(),
  }).where(eq(twilioUsageBudget.id, configId));
}

async function ownerCanReceiveAlert(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ownerId: string | null) {
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

async function saveUsageAndNotify(
  snapshot: Awaited<ReturnType<typeof getTwilioVideoUsage>>,
  now: Date,
  configId = CONFIG_ID,
) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(twilioUsageBudget)
      .where(eq(twilioUsageBudget.id, configId)).for("update");
    if (!row) return;

    const nextCheckAt = new Date(now.getTime() + CHECK_INTERVAL_MS).toISOString();
    const periodStart = snapshot.periodStart;
    const periodEnd = snapshot.periodEnd;
    const fallbackPeriod = currentMonthRange(now);
    const historyPeriodStart = periodStart ?? (snapshot.status === "success" ? null : fallbackPeriod.start);
    if (historyPeriodStart) {
      const historyValues = {
        periodStart: historyPeriodStart,
        periodEnd: periodEnd ?? (periodStart ? null : fallbackPeriod.end),
        status: snapshot.status,
        spend: snapshot.spend,
        currency: snapshot.currency,
        participantMinutes: snapshot.participantMinutes,
        usageAsOf: snapshot.asOf,
        checkedAt: now.toISOString(),
      };
      await tx.insert(twilioUsageHistory).values(historyValues).onConflictDoUpdate({
        target: twilioUsageHistory.periodStart,
        set: {
          periodEnd: historyValues.periodEnd,
          status: historyValues.status,
          spend: historyValues.spend,
          currency: historyValues.currency,
          participantMinutes: historyValues.participantMinutes,
          usageAsOf: historyValues.usageAsOf,
          checkedAt: historyValues.checkedAt,
        },
      });
    }
    await tx.update(twilioUsageBudget).set({
      lookupStatus: snapshot.status,
      currentSpend: snapshot.spend,
      usageCurrency: snapshot.currency,
      participantMinutes: snapshot.participantMinutes,
      periodStart,
      periodEnd,
      usageAsOf: snapshot.asOf,
      lastAttemptAt: now.toISOString(),
      lastSuccessAt: now.toISOString(),
      nextCheckAt,
    }).where(eq(twilioUsageBudget.id, configId));

    const spend = snapshot.spend === null ? null : Number(snapshot.spend);
    const budget = amount(row.budgetAmount);
    const matchesCurrentPeriod = periodStart === currentMonthStart(now);
    if (snapshot.status !== "success" || !row.enabled || spend === null || budget === null ||
      budget <= 0 || !snapshot.currency || snapshot.currency !== row.budgetCurrency || !matchesCurrentPeriod)
      return;

    const approaching = spend >= budget * row.warningPercent / 100;
    const reached = spend >= budget;
    if (!approaching && !reached) return;
    if (!await ownerCanReceiveAlert(tx, row.configuredBy)) return;

    const levels = [
      ...(approaching ? [{
        level: "approaching",
        title: `Twilio Video usage reached ${row.warningPercent}% of budget`,
        percent: row.warningPercent,
      }] : []),
      ...(reached ? [{
        level: "reached",
        title: "Twilio Video usage reached the monthly budget",
        percent: 100,
      }] : []),
    ];
    const dataDate = snapshot.asOf ? `Data as of ${snapshot.asOf}.` : "Twilio did not provide an as-of timestamp.";
    for (const alert of levels) {
      await tx.insert(notifications).values({
        id: randomUUID(),
        userId: row.configuredBy!,
        eventKey: `twilio-video-budget:${configId}:${periodStart}:${alert.level}`,
        title: alert.title,
        body: `Posted Twilio Programmable Video usage is ${formattedMoney(spend, snapshot.currency)} against your ${formattedMoney(budget, row.budgetCurrency)} monthly budget (${alert.percent}% alert). ${dataDate} Usage records can lag up to 24 hours. This is a warning, not a spending cap; active calls are not interrupted.`,
        link: "/admin",
      }).onConflictDoNothing();
    }
  });
}

export async function refreshTwilioUsageBudget(options: RefreshOptions = {}) {
  const now = options.now ?? new Date();
  const claimed = await claimLookup(options, now);
  const configId = options.configId ?? CONFIG_ID;
  if (!claimed) return getTwilioUsageBudgetState(now, configId);

  if (!twilioUsageLookupConfigured()) {
    await finishFailedLookup("not_configured", now, configId);
    return getTwilioUsageBudgetState(now, configId);
  }

  try {
    const snapshot = await (options.fetchUsage ?? getTwilioVideoUsage)();
    await saveUsageAndNotify(snapshot, now, configId);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
      ? error.code
      : undefined;
    logger.warn({ code }, "Twilio Video usage lookup failed; the last successful snapshot was retained");
    await finishFailedLookup("failed", now, configId);
  }
  return getTwilioUsageBudgetState(now, configId);
}

export async function runTwilioUsageBudgetCheck(now = new Date()) {
  return refreshTwilioUsageBudget({ now });
}

export function startTwilioUsageBudgetWorker() {
  const tick = () => {
    void runTwilioUsageBudgetCheck().catch(() => logger.error("Twilio usage budget worker tick failed"));
  };
  tick();
  const timer = setInterval(tick, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
