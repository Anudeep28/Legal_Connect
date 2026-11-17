import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import nock from "nock";
import {
  accounts,
  auditLogs,
  db,
  notifications,
  pool,
  twilioUsageBudget,
} from "@workspace/db";
import { getTwilioVideoUsage, type TwilioVideoUsageSnapshot } from "../consultation-calls";
import { getTwilioUsageBudgetState, refreshTwilioUsageBudget, saveTwilioUsageBudgetConfig } from "../twilio-usage-budget";

assert.equal(process.env.NODE_ENV, "test");
const prefix = `twilio-budget-fixture-${randomUUID()}`;
const accountSid = `AC${"1".repeat(32)}`;
const ownerId = `${prefix}-owner`;
const alertConfigId = `${prefix}-alert`;
const mismatchConfigId = `${prefix}-mismatch`;
const partialConfigId = `${prefix}-partial`;
const noDataConfigId = `${prefix}-no-data`;
const monthStart = "2026-11-01";
const monthEnd = "2026-11-30";
const now = new Date("2026-11-17T10:00:00.000Z");
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
  await db.delete(twilioUsageBudget).where(inArray(twilioUsageBudget.id, [alertConfigId, mismatchConfigId, partialConfigId, noDataConfigId]));
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
  }, ownerId, now, noDataConfigId);
  const result = await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId: noDataConfigId,
    now,
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
