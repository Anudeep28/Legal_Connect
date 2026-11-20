import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import nock from "nock";
import webPush from "web-push";
import { GetAdminTwilioUsageHistoryResponse } from "@workspace/api-zod";
import {
  accounts,
  auditLogs,
  db,
  communicationDeliveries,
  notifications,
  pool,
  pushSubscriptions,
  twilioUsageBudget,
  twilioUsageHistory,
} from "@workspace/db";
import { getTwilioVideoUsage, type TwilioVideoUsageSnapshot } from "../consultation-calls";
import { getTwilioUsageBudgetState, getTwilioUsageHistory, refreshTwilioUsageBudget, saveTwilioUsageBudgetConfig } from "../twilio-usage-budget";
import { deliver, queueOutbound } from "../communication-worker";

assert.equal(process.env.NODE_ENV, "test");
const prefix = `twilio-budget-fixture-${randomUUID()}`;
const fixtureYear = 2090 + Number.parseInt(randomUUID().slice(0, 2), 16) % 8;
const accountSid = `AC${"1".repeat(32)}`;
const ownerId = `${prefix}-owner`;
const emailOnlyOwnerId = `${prefix}-email-only`;
const pushOnlyOwnerId = `${prefix}-push-only`;
const disabledOwnerId = `${prefix}-disabled`;
const alertConfigId = `${prefix}-alert`;
const mismatchConfigId = `${prefix}-mismatch`;
const partialConfigId = `${prefix}-partial`;
const noDataConfigId = `${prefix}-no-data`;
const historyZeroConfigId = `${prefix}-history-zero`;
const historyPartialConfigId = `${prefix}-history-partial`;
const historyNoDataConfigId = `${prefix}-history-no-data`;
const emailAlertConfigId = `${prefix}-email-alert`;
const pushAlertConfigId = `${prefix}-push-alert`;
const disabledAlertConfigId = `${prefix}-disabled-alert`;
const monthStart = `${fixtureYear}-11-01`;
const monthEnd = `${fixtureYear}-11-30`;
const now = new Date(`${fixtureYear}-11-17T10:00:00.000Z`);
const noDataStart = `${fixtureYear}-12-01`;
const noDataNow = new Date(`${fixtureYear}-12-17T10:00:00.000Z`);
const historyZeroStart = `${fixtureYear + 1}-01-01`;
const historyPartialStart = `${fixtureYear + 1}-02-01`;
const historyNoDataStart = `${fixtureYear + 1}-03-01`;
const historyNoDataNow = new Date(`${fixtureYear + 1}-03-17T10:00:00.000Z`);
const pushSubscriptionId = `${prefix}-push-subscription`;
const testSnapshot = (spend: string, currency = "USD"): TwilioVideoUsageSnapshot => ({
  status: "success",
  spend,
  currency,
  participantMinutes: "41.5000",
  periodStart: monthStart,
  periodEnd: monthEnd,
  asOf: now.toISOString(),
});
const originalFetch = globalThis.fetch;
const originalPushSend = webPush.sendNotification;

async function leaseDelivery(id: string) {
  const [job] = await db.update(communicationDeliveries).set({
    status: "processing",
    lockToken: randomUUID(),
    lockedUntil: new Date(Date.now() + 120_000).toISOString(),
  }).where(eq(communicationDeliveries.id, id)).returning();
  assert.ok(job);
  return job;
}

async function createBudgetAlerts(ownerId: string, configId: string, spend: string) {
  await saveTwilioUsageBudgetConfig({
    enabled: true,
    budgetAmount: 10,
    budgetCurrency: "USD",
    warningPercent: 80,
  }, ownerId, now, configId);
  const result = await refreshTwilioUsageBudget({
    force: true,
    ownerId,
    configId,
    now,
    fetchUsage: async () => testSnapshot(spend),
  });
  assert.equal(result.alertLevel, Number(spend) >= 10 ? "reached" : "approaching");
  const alerts = await db.select().from(notifications)
    .where(like(notifications.eventKey, `twilio-video-budget:${configId}:%`));
  assert.equal(alerts.length, Number(spend) >= 10 ? 2 : 1);
  return alerts;
}

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
  for (const [id, emailNotifications, pushNotifications] of [
    [emailOnlyOwnerId, true, false],
    [pushOnlyOwnerId, false, true],
    [disabledOwnerId, false, false],
  ] as const) {
    await db.insert(accounts).values({
      id,
      name: "Synthetic delivery owner",
      email: `${id}@example.com`,
      emailNotifications,
      pushNotifications,
      role: "admin",
      status: "active",
    });
  }
  await db.insert(auditLogs).values([
    ownerId, emailOnlyOwnerId, pushOnlyOwnerId, disabledOwnerId,
  ].map((id) => ({
    id: randomUUID(),
    actorId: id,
    targetId: id,
    action: "admin:owner-designated",
    reason: "Synthetic test authorization",
  })));
});

after(async () => {
  globalThis.fetch = originalFetch;
  webPush.sendNotification = originalPushSend;
  nock.cleanAll();
  nock.enableNetConnect();
  await db.delete(notifications).where(inArray(notifications.userId, [
    ownerId, emailOnlyOwnerId, pushOnlyOwnerId, disabledOwnerId,
  ]));
  await db.delete(twilioUsageBudget).where(inArray(twilioUsageBudget.id, [
    alertConfigId, mismatchConfigId, partialConfigId, noDataConfigId,
    historyZeroConfigId, historyPartialConfigId, historyNoDataConfigId,
    emailAlertConfigId, pushAlertConfigId, disabledAlertConfigId,
  ]));
  await db.delete(twilioUsageHistory).where(inArray(twilioUsageHistory.periodStart, [
    monthStart, noDataStart, historyZeroStart, historyPartialStart, historyNoDataStart,
  ]));
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, [
    ownerId, emailOnlyOwnerId, pushOnlyOwnerId, disabledOwnerId,
  ]));
  await db.delete(accounts).where(inArray(accounts.id, [
    ownerId, emailOnlyOwnerId, pushOnlyOwnerId, disabledOwnerId,
  ]));
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

test("Twilio warnings queue and retry only the owner's enabled email and push channels", async () => {
  Object.assign(process.env, {
    EMAIL_DELIVERY_ENABLED: "true",
    RESEND_API_KEY: "synthetic-resend-key",
    EMAIL_FROM: "Test <test@example.com>",
    APP_PUBLIC_URL: "https://example.com",
    PUSH_DELIVERY_ENABLED: "true",
    VAPID_PUBLIC_KEY: "synthetic-vapid-public",
    VAPID_PRIVATE_KEY: "synthetic-vapid-private",
    VAPID_SUBJECT: "mailto:test@example.com",
  });

  const emailWarnings = await createBudgetAlerts(emailOnlyOwnerId, emailAlertConfigId, "10.500000");
  await queueOutbound([emailOnlyOwnerId]);
  const emailJobs = await db.select().from(communicationDeliveries)
    .where(inArray(communicationDeliveries.notificationId, emailWarnings.map((warning) => warning.id)));
  assert.equal(emailJobs.length, 2, "warning and exceeded alerts both create outbound jobs");
  assert.ok(emailJobs.every((job) => job.channel === "email"), "push preference is off for this owner");

  const emailRequests: Array<{ idempotencyKey: string | null; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    emailRequests.push({
      idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
      body: String(init?.body),
    });
    return emailRequests.length === 1
      ? Response.json({ message: "synthetic rate limit" }, { status: 429 })
      : Response.json({ id: "synthetic-resend-message" });
  };
  const emailJob = emailJobs[0]!;
  assert.ok(emailJob);
  await deliver(await leaseDelivery(emailJob.id));
  assert.equal((await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.id, emailJob.id)))[0]?.status, "retry");
  await db.update(communicationDeliveries).set({
    nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
  }).where(eq(communicationDeliveries.id, emailJob.id));
  await deliver(await leaseDelivery(emailJob.id));
  const [emailDelivered] = await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.id, emailJob.id));
  assert.equal(emailDelivered?.status, "accepted");
  assert.equal(emailDelivered?.providerId, "synthetic-resend-message");
  assert.equal(emailDelivered?.attempts, 2);
  assert.deepEqual(emailRequests.map((request) => request.idempotencyKey), [emailJob.id, emailJob.id]);
  assert.equal(emailRequests[0]?.body, emailRequests[1]?.body, "retry reuses the frozen email payload");

  const pushWarnings = await createBudgetAlerts(pushOnlyOwnerId, pushAlertConfigId, "10.500000");
  await db.insert(pushSubscriptions).values({
    id: pushSubscriptionId,
    userId: pushOnlyOwnerId,
    endpoint: `https://fcm.googleapis.com/fcm/send/${pushSubscriptionId}`,
    keys: { p256dh: "synthetic-p256dh", auth: "synthetic-auth" },
  });
  await queueOutbound([pushOnlyOwnerId]);
  const pushJobs = await db.select().from(communicationDeliveries)
    .where(inArray(communicationDeliveries.notificationId, pushWarnings.map((warning) => warning.id)));
  assert.equal(pushJobs.length, 2);
  assert.ok(pushJobs.every((job) => job.channel === "push"), "email preference is off for this owner");

  const pushRequests: string[] = [];
  let pushAttempt = 0;
  webPush.sendNotification = async (_subscription, payload) => {
    pushRequests.push(String(payload));
    pushAttempt++;
    if (pushAttempt === 1) throw Object.assign(new Error("synthetic provider outage"), { statusCode: 503 });
    return { statusCode: 201, headers: {}, body: "" };
  };
  const pushJob = pushJobs[0]!;
  assert.ok(pushJob);
  await deliver(await leaseDelivery(pushJob.id));
  assert.equal((await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.id, pushJob.id)))[0]?.status, "retry");
  await db.update(communicationDeliveries).set({
    nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
  }).where(eq(communicationDeliveries.id, pushJob.id));
  await deliver(await leaseDelivery(pushJob.id));
  const [pushDelivered] = await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.id, pushJob.id));
  assert.equal(pushDelivered?.status, "accepted");
  assert.equal(pushDelivered?.attempts, 2);
  assert.equal(pushRequests.length, 2);
  assert.equal(pushRequests[0], pushRequests[1], "push retry keeps the same replacement tag and payload");
  const pushPayload = JSON.parse(pushRequests[0]!) as { tag: string };
  assert.ok(pushWarnings.some((warning) => warning.id === pushPayload.tag));

  const disabledWarnings = await createBudgetAlerts(disabledOwnerId, disabledAlertConfigId, "10.500000");
  await queueOutbound([disabledOwnerId]);
  const disabledJobs = await db.select().from(communicationDeliveries)
    .where(inArray(communicationDeliveries.notificationId, disabledWarnings.map((warning) => warning.id)));
  assert.equal(disabledJobs.length, 0, "disabled email and push preferences create no outbound jobs");
});
