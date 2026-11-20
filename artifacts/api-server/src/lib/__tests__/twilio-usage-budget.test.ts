import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import nock from "nock";
import { GetAdminTwilioUsageHistoryResponse } from "@workspace/api-zod";
import {
  accounts,
  auditLogs,
  db,
  notifications,
  pool,
  twilioUsageBudget,
  twilioUsageHistory,
} from "@workspace/db";
import { getTwilioVideoUsage, type TwilioVideoUsageSnapshot } from "../consultation-calls";
import { getTwilioUsageBudgetState, getTwilioUsageHistory, refreshTwilioUsageBudget, saveTwilioUsageBudgetConfig } from "../twilio-usage-budget";

assert.equal(process.env.NODE_ENV, "test");
const prefix = `twilio-budget-fixture-${randomUUID()}`;
const fixtureYear = 2090 + Number.parseInt(randomUUID().slice(0, 2), 16) % 8;
const accountSid = `AC${"1".repeat(32)}`;
const ownerId = `${prefix}-owner`;
const alertConfigId = `${prefix}-alert`;
const mismatchConfigId = `${prefix}-mismatch`;
const partialConfigId = `${prefix}-partial`;
const noDataConfigId = `${prefix}-no-data`;
const historyZeroConfigId = `${prefix}-history-zero`;
const historyPartialConfigId = `${prefix}-history-partial`;
const historyNoDataConfigId = `${prefix}-history-no-data`;
const monthStart = `${fixtureYear}-11-01`;
const monthEnd = `${fixtureYear}-11-30`;
const now = new Date(`${fixtureYear}-11-17T10:00:00.000Z`);
const noDataStart = `${fixtureYear}-12-01`;
const noDataNow = new Date(`${fixtureYear}-12-17T10:00:00.000Z`);
const historyZeroStart = `${fixtureYear + 1}-01-01`;
const historyPartialStart = `${fixtureYear + 1}-02-01`;
const historyNoDataStart = `${fixtureYear + 1}-03-01`;
const historyNoDataNow = new Date(`${fixtureYear + 1}-03-17T10:00:00.000Z`);
const testSnapshot = (spend: string, currency = "USD"): TwilioVideoUsageSnapshot => ({
  status: "success",
  spend,
  currency,
  participantMinutes: "41.5000",
  periodStart: monthStart,
  periodEnd: monthEnd,
  asOf: now.toISOString(),
});

before(async () => {
  process.env.TWILIO_ACCOUNT_SID = accountSid;
  process.env.TWILIO_AUTH_TOKEN = "synthetic-twilio-auth-token";
  nock.disableNetConnect();
  await db.insert(accounts).values({
    id: ownerId,
    name: "Synthetic budget owner",
    email: `${ownerId}@example.com`,
    role: "admin",
    status: "active",
  });
  await db.insert(auditLogs).values({
    id: randomUUID(),
    actorId: ownerId,
    targetId: ownerId,
    action: "admin:owner-designated",
    reason: "Synthetic test authorization",
  });
});

after(async () => {
  nock.cleanAll();
  nock.enableNetConnect();
  await db.delete(notifications).where(eq(notifications.userId, ownerId));
  await db.delete(twilioUsageBudget).where(inArray(twilioUsageBudget.id, [
    alertConfigId, mismatchConfigId, partialConfigId, noDataConfigId,
    historyZeroConfigId, historyPartialConfigId, historyNoDataConfigId,
  ]));
  await db.delete(twilioUsageHistory).where(inArray(twilioUsageHistory.periodStart, [
    monthStart, noDataStart, historyZeroStart, historyPartialStart, historyNoDataStart,
  ]));
  await db.delete(auditLogs).where(eq(auditLogs.actorId, ownerId));
  await db.delete(accounts).where(eq(accounts.id, ownerId));
  await pool.end();
});

test("Twilio usage reader totals posted Video charges and Group Room minutes", async () => {
  const interceptor = nock("https://api.twilio.com")
    .get(`/2010-04-01/Accounts/${accountSid}/Usage/Records/ThisMonth.json`)
    .query((params) => params.IncludeSubaccounts === "false")
    .reply(200, {
      usage_records: [
        {
          account_sid: accountSid,
          category: "pv",
          description: "Programmable Video",
          start_date: monthStart,
          end_date: monthEnd,
          as_of: now.toISOString(),
          price: "1.250000",
          price_unit: "usd",
          usage: "1",
          usage_unit: "unit",
        },
        {
          account_sid: accountSid,
          category: "pv",
          description: "Programmable Video adjustment",
          start_date: monthStart,
          end_date: monthEnd,
          as_of: now.toISOString(),
          price: "0.250000",
          price_unit: "USD",
          usage: "1",
          usage_unit: "unit",
        },
        {
          account_sid: accountSid,
          category: "group-rooms-participant-minutes",
          description: "Group Rooms Participant Minutes",
          start_date: monthStart,
          end_date: monthEnd,
          as_of: now.toISOString(),
          price: "0.000000",
          price_unit: "USD",
          usage: "41.5",
          usage_unit: "minutes",
        },
      ],
    });

  const usage = await getTwilioVideoUsage();
  assert.equal(usage.status, "success");
  assert.equal(usage.spend, "1.500000");
  assert.equal(usage.currency, "USD");
  assert.equal(usage.participantMinutes, "41.5000");
  assert.equal(usage.periodStart, monthStart);
  assert.equal(usage.asOf, now.toISOString());
  assert.equal(interceptor.isDone(), true);
});

test("no posted records remain unavailable instead of implying zero spend", async () => {
  const interceptor = nock("https://api.twilio.com")
    .get(`/2010-04-01/Accounts/${accountSid}/Usage/Records/ThisMonth.json`)
    .query((params) => params.IncludeSubaccounts === "false")
    .reply(200, { usage_records: [] });
  const usage = await getTwilioVideoUsage();
  assert.equal(usage.status, "no_data");
  assert.equal(usage.spend, null);
  assert.equal(usage.currency, null);
  assert.equal(usage.participantMinutes, null);
  assert.equal(interceptor.isDone(), true);

  await saveTwilioUsageBudgetConfig({
    enabled: true,
    budgetAmount: 10,
    budgetCurrency: "USD",
    warningPercent: 80,
  }, ownerId, noDataNow, noDataConfigId);
  const result = await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId: noDataConfigId,
    now: noDataNow,
    fetchUsage: async () => usage,
  });
  assert.equal(result.lookupStatus, "no_data");
  assert.equal(result.currentSpend, null);
  assert.equal(result.alertLevel, "none");
});

test("owner receives one warning and one exceeded alert, with duplicate delivery suppressed", async () => {
  const start = await saveTwilioUsageBudgetConfig({
    enabled: true,
    budgetAmount: 10,
    budgetCurrency: "USD",
    warningPercent: 80,
  }, ownerId, now, alertConfigId);
  assert.equal(start.enabled, true);

  const atWarning = await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId: alertConfigId,
    now,
    fetchUsage: async () => testSnapshot("8.250000"),
  });
  assert.equal(atWarning.alertLevel, "approaching");

  const warningCount = await db.select().from(notifications)
    .where(like(notifications.eventKey, `twilio-video-budget:${alertConfigId}:%`));
  assert.equal(warningCount.length, 1);

  await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId: alertConfigId,
    now: new Date(now.getTime() + 60_000),
    fetchUsage: async () => testSnapshot("8.500000"),
  });
  const afterRepeat = await db.select().from(notifications)
    .where(like(notifications.eventKey, `twilio-video-budget:${alertConfigId}:%`));
  assert.equal(afterRepeat.length, 1);

  const overBudget = await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId: alertConfigId,
    now: new Date(now.getTime() + 120_000),
    fetchUsage: async () => testSnapshot("10.250000"),
  });
  assert.equal(overBudget.alertLevel, "reached");
  const finalNotifications = await db.select().from(notifications)
    .where(like(notifications.eventKey, `twilio-video-budget:${alertConfigId}:%`));
  assert.equal(finalNotifications.length, 2);
  assert.ok(finalNotifications.every((notification) => notification.body.includes("not a spending cap")));
});

test("failed lookup retains the last posted amount and never treats failure as zero", async () => {
  const failed = await refreshTwilioUsageBudget({
    force: true,
    configId: alertConfigId,
    now: new Date(now.getTime() + 180_000),
    fetchUsage: async () => { throw new Error("synthetic provider failure"); },
  });
  assert.equal(failed.lookupStatus, "failed");
  assert.equal(failed.currentSpend, 10.25);
  assert.equal(failed.usageCurrency, "USD");
  const persisted = await getTwilioUsageBudgetState(new Date(now.getTime() + 180_000), alertConfigId);
  assert.equal(persisted.currentSpend, 10.25);
  assert.equal(persisted.lookupStatus, "failed");
});

test("currency mismatch suppresses comparisons and participant-only data remains partial", async () => {
  await saveTwilioUsageBudgetConfig({
    enabled: true,
    budgetAmount: 100,
    budgetCurrency: "INR",
    warningPercent: 80,
  }, ownerId, now, mismatchConfigId);
  const mismatch = await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId: mismatchConfigId,
    now,
    fetchUsage: async () => testSnapshot("500.000000", "USD"),
  });
  assert.equal(mismatch.currencyMatches, false);
  assert.equal(mismatch.alertLevel, "none");

  await saveTwilioUsageBudgetConfig({
    enabled: true,
    budgetAmount: 10,
    budgetCurrency: "USD",
    warningPercent: 80,
  }, ownerId, now, partialConfigId);
  const partial = await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId: partialConfigId,
    now,
    fetchUsage: async () => ({
      status: "partial",
      spend: null,
      currency: null,
      participantMinutes: "250.0000",
      periodStart: monthStart,
      periodEnd: monthEnd,
      asOf: now.toISOString(),
    }),
  });
  assert.equal(partial.lookupStatus, "partial");
  assert.equal(partial.currentSpend, null);
  assert.equal(partial.participantMinutes, 250);
  assert.equal(partial.alertLevel, "none");
  const partialNotifications = await db.select().from(notifications)
    .where(like(notifications.eventKey, `twilio-video-budget:${partialConfigId}:%`));
  assert.equal(partialNotifications.length, 0);
});

test("monthly history keeps posted zero, partial and missing data distinct and upserts by provider period", async () => {
  await saveTwilioUsageBudgetConfig({
    enabled: false,
    budgetAmount: 10,
    budgetCurrency: "USD",
    warningPercent: 80,
  }, ownerId, now, historyZeroConfigId);
  const zeroSnapshot: TwilioVideoUsageSnapshot = {
    ...testSnapshot("0.000000"),
    periodStart: historyZeroStart,
    periodEnd: `${fixtureYear + 1}-01-31`,
  };
  await refreshTwilioUsageBudget({
    configId: historyZeroConfigId,
    now,
    fetchUsage: async () => zeroSnapshot,
  });
  const laterCheck = new Date(now.getTime() + 60_000);
  await refreshTwilioUsageBudget({
    force: true,
    configId: historyZeroConfigId,
    now: laterCheck,
    fetchUsage: async () => ({ ...zeroSnapshot, asOf: laterCheck.toISOString() }),
  });

  await saveTwilioUsageBudgetConfig({
    enabled: false,
    budgetAmount: 10,
    budgetCurrency: "USD",
    warningPercent: 80,
  }, ownerId, now, historyPartialConfigId);
  await refreshTwilioUsageBudget({
    force: true,
    configId: historyPartialConfigId,
    now,
    fetchUsage: async () => ({
      status: "partial",
      spend: null,
      currency: null,
      participantMinutes: "250.0000",
      periodStart: historyPartialStart,
      periodEnd: `${fixtureYear + 1}-02-28`,
      asOf: now.toISOString(),
    }),
  });

  await saveTwilioUsageBudgetConfig({
    enabled: false,
    budgetAmount: 10,
    budgetCurrency: "USD",
    warningPercent: 80,
  }, ownerId, historyNoDataNow, historyNoDataConfigId);
  await refreshTwilioUsageBudget({
    force: true,
    configId: historyNoDataConfigId,
    now: historyNoDataNow,
    fetchUsage: async () => ({
      status: "no_data",
      spend: null,
      currency: null,
      participantMinutes: null,
      periodStart: null,
      periodEnd: null,
      asOf: null,
    }),
  });

  const history = await getTwilioUsageHistory();
  assert.doesNotThrow(() => GetAdminTwilioUsageHistoryResponse.parse(history));
  const zero = history.months.filter((month) => month.periodStart === historyZeroStart);
  assert.equal(zero.length, 1, "rechecking one provider period must update its existing history row");
  assert.equal(zero[0]?.status, "success");
  assert.equal(zero[0]?.spend, 0, "a posted zero is stored as a real charge value");
  assert.equal(zero[0]?.usageAsOf, laterCheck.toISOString());

  const partial = history.months.find((month) => month.periodStart === historyPartialStart);
  assert.equal(partial?.status, "partial");
  assert.equal(partial?.spend, null);
  assert.equal(partial?.participantMinutes, 250);

  const missing = history.months.find((month) => month.periodStart === historyNoDataStart);
  assert.equal(missing?.status, "no_data");
  assert.equal(missing?.spend, null);
  assert.equal(missing?.participantMinutes, null);
  assert.equal(missing?.periodEnd, `${fixtureYear + 1}-03-31`);
  assert.equal(missing?.usageAsOf, null);
});
