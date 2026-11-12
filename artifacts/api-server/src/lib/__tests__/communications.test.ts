import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import nock from "nock";
import webPush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { db, pool, accounts, lawyers, consultations, notifications, communicationDeliveries, callConsents, pushSubscriptions } from "@workspace/db";
import { callEligibility, isParticipant, reminderDue, retryAllowed, retryDelay, validPushEndpoint, phoneApproved, HOUR, MINUTE } from "../communication-policy";
import { callsEnabled, emailEnabled, phoneVerificationEnabled, pushEnabled } from "../communication-config";
import { scheduleReminders, queueOutbound, claimDelivery, deliver } from "../communication-worker";
import { issueCallAccess } from "../consultation-calls";

// Synthetic fixtures only. No real provider traffic or application flags are changed.
assert.equal(process.env.NODE_ENV, "test");
const prefix = `communication-fixture-${randomUUID()}`;
const clientId = `${prefix}-client`;
const lawyerOwnerId = `${prefix}-lawyer`;
const outsiderId = `${prefix}-outsider`;
const lawyerId = `${prefix}-profile`;
const consultationIds: string[] = [];
const fixtureNotifications: string[] = [];
const originalFetch = globalThis.fetch;

before(async () => {
  process.env.TWILIO_CALLS_ENABLED = "false";
  process.env.TWILIO_VERIFY_ENABLED = "false";
  process.env.EMAIL_DELIVERY_ENABLED = "false";
  process.env.PUSH_DELIVERY_ENABLED = "false";
  nock.disableNetConnect();
  // Never read or reuse actual provider credentials in the test process.
  Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: `AC${"1".repeat(32)}`, TWILIO_AUTH_TOKEN: "synthetic-auth-token",
    TWILIO_API_KEY_SID: `SK${"2".repeat(32)}`, TWILIO_API_KEY_SECRET: "synthetic-api-key-secret",
    RESEND_API_KEY: "synthetic-resend-key", EMAIL_FROM: "Fixture <fixture@example.com>",
    APP_PUBLIC_URL: "https://example.com",
  });
  for (const id of [clientId, lawyerOwnerId, outsiderId]) {
    await db.insert(accounts).values({ id, name: "Communication fixture", email: `${id}@example.com`, emailNotifications: true, role: id === lawyerOwnerId ? "lawyer" : "client" });
  }
  await db.insert(lawyers).values({
    id: lawyerId, ownerId: lawyerOwnerId, name: "Fixture advocate", title: "Fixture", bio: "Synthetic test profile",
    practiceAreas: ["Civil Law"], languages: ["English"], experienceYears: 1, barCouncil: "Fixture",
    enrollmentNumber: prefix, fee: 100, city: "Fixture", availability: [0, 1, 2, 3, 4, 5, 6], approvalStatus: "approved",
  });
});
after(async () => {
  globalThis.fetch = originalFetch;
  nock.cleanAll(); nock.enableNetConnect();
  await db.delete(notifications).where(inArray(notifications.userId, [clientId, lawyerOwnerId, outsiderId]));
  await db.delete(consultations).where(eq(consultations.lawyerId, lawyerId));
  await db.delete(lawyers).where(eq(lawyers.id, lawyerId));
  await db.delete(accounts).where(inArray(accounts.id, [clientId, lawyerOwnerId, outsiderId]));
  await pool.end();
});
async function account(id: string) {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, id)); return a;
}
async function consultation(offset: number, overrides: Partial<typeof consultations.$inferInsert> = {}) {
  const id = randomUUID(); consultationIds.push(id);
  const startsAt = new Date(Date.now() + offset).toISOString();
  const [c] = await db.insert(consultations).values({
    id, userId: clientId, lawyerId, mode: "call", package: "consultation_only", status: "booked", paymentStatus: "paid",
    topic: "Synthetic communication fixture", fee: 100, startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 30 * MINUTE).toISOString(), ...overrides,
  }).returning();
  return c;
}
async function notification() {
  const id = randomUUID(); fixtureNotifications.push(id);
  await db.insert(notifications).values({ id, userId: clientId, title: "Fixture update", body: "Private synthetic body", link: "/notifications" });
  await queueOutbound([clientId, lawyerOwnerId]);
  const [job] = await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.notificationId, id));
  assert.ok(job); return job;
}
async function lease(id: string) {
  // Claim a specific isolated fixture; other live development jobs are untouched.
  const [job] = await db.update(communicationDeliveries).set({
    status: "processing", lockToken: randomUUID(), lockedUntil: new Date(Date.now() + 2 * MINUTE).toISOString(),
  }).where(eq(communicationDeliveries.id, id)).returning();
  return job;
}
async function refreshed(id: string) {
  const [job] = await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.id, id)); return job;
}

test("service flags stay disabled without explicit activation", () => {
  assert.equal(callsEnabled(), false); assert.equal(emailEnabled(), false);
  assert.equal(phoneVerificationEnabled(), false); assert.equal(pushEnabled(), false);
});
test("participant checks exclude non-participants, including administrators", () => {
  const c = { userId: clientId, lawyerOwnerId };
  assert.equal(isParticipant({ id: clientId }, c), true);
  assert.equal(isParticipant({ id: lawyerOwnerId }, c), true);
  assert.equal(isParticipant({ id: outsiderId }, c), false);
});
test("call window, payment, demo and status boundaries", () => {
  const now = Date.now();
  const c = { mode: "call", status: "booked", demo: false, paymentStatus: "paid", startsAt: new Date(now + 10 * MINUTE).toISOString(), endsAt: new Date(now + 40 * MINUTE).toISOString() };
  assert.equal(callEligibility(c, true, now).canJoin, true);
  assert.equal(callEligibility(c, true, now - 1).canJoin, false);
  assert.equal(callEligibility(c, true, now + 40 * MINUTE).canJoin, false);
  for (const change of [{ demo: true }, { status: "cancelled" }, { status: "requested" }, { paymentStatus: "unpaid" }, { mode: "chat" }])
    assert.equal(callEligibility({ ...c, ...change }, true, now).canJoin, false);
  assert.equal(callEligibility(c, false, now).canJoin, false);
});
test("reminder and retry limits reject stale work", () => {
  const now = Date.now();
  assert.equal(reminderDue(new Date(now + 24 * HOUR).toISOString(), 1440, now), true);
  assert.equal(reminderDue(new Date(now + 22 * HOUR).toISOString(), 1440, now), false);
  assert.equal(reminderDue(new Date(now + 10 * MINUTE).toISOString(), 10, now), true);
  assert.equal(reminderDue(new Date(now).toISOString(), 10, now), false);
  assert.equal(retryAllowed(10, null), false);
  assert.equal(retryAllowed(2, new Date(now - 21 * HOUR).toISOString(), now), false);
  assert.equal(retryDelay(1), 30_000); assert.equal(retryDelay(10), HOUR);
});
test("push destinations cannot target private services or lookalike domains", () => {
  assert.equal(validPushEndpoint("https://fcm.googleapis.com/fcm/send/fixture"), true);
  assert.equal(validPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/fixture"), true);
  for (const endpoint of ["https://127.0.0.1/api", "http://fcm.googleapis.com/test", "https://fcm.googleapis.com.evil.example/test", "https://user@fcm.googleapis.com/test", "https://fcm.googleapis.com:8443/test"])
    assert.equal(validPushEndpoint(endpoint), false);
});
test("phone approval requires provider confirmation for the exact challenged phone", () => {
  const to = "+15005550006"; // Twilio's published fictional test number.
  assert.equal(phoneApproved({ status: "approved", valid: true, to }, to), true);
  assert.equal(phoneApproved({ status: "pending", valid: true, to }, to), false);
  assert.equal(phoneApproved({ status: "approved", valid: false, to }, to), false);
  assert.equal(phoneApproved({ status: "approved", valid: true, to: "+15005550009" }, to), false);
});
test("24-hour and 10-minute reminders are durable, participant-scoped and deduplicated", async () => {
  const long = await consultation(24 * HOUR - MINUTE);
  const short = await consultation(10 * MINUTE - MINUTE);
  const unpaid = await consultation(10 * MINUTE - 2 * MINUTE, { paymentStatus: "unpaid" });
  const cancelled = await consultation(10 * MINUTE - 3 * MINUTE, { status: "cancelled" });
  const demo = await consultation(10 * MINUTE - 4 * MINUTE, { demo: true });
  await scheduleReminders(Date.now(), consultationIds); await scheduleReminders(Date.now(), consultationIds);
  const rows = await db.select().from(notifications).where(inArray(notifications.consultationId, [long.id, short.id, unpaid.id, cancelled.id, demo.id]));
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((r) => r.eventKey)).size, 4);
  assert.deepEqual(new Set(rows.map((r) => r.userId)), new Set([clientId, lawyerOwnerId]));
  await queueOutbound([clientId, lawyerOwnerId]); await queueOutbound([clientId, lawyerOwnerId]);
  const jobs = await db.select().from(communicationDeliveries).where(inArray(communicationDeliveries.notificationId, rows.map((r) => r.id)));
  assert.equal(jobs.length, 4);
});
test("unconfigured delivery is blocked, never accepted", async () => {
  const job = await notification();
  await deliver(await lease(job.id));
  const actual = await refreshed(job.id);
  assert.equal(actual.status, "blocked"); assert.equal(actual.attempts, 0);
});
test("Resend retries use durable idempotency and frozen content, and require an actual provider ID", async () => {
  process.env.EMAIL_DELIVERY_ENABLED = "true";
  const job = await notification();
  const payloads: string[] = [];
  let requestCount = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), job.id);
    payloads.push(String(init?.body)); requestCount++;
    if (requestCount === 1) return Response.json({ message: "synthetic rate limit" }, { status: 429 });
    return Response.json({ id: "synthetic-resend-message" });
  };
  await deliver(await lease(job.id));
  assert.equal((await refreshed(job.id)).status, "retry");
  process.env.EMAIL_FROM = "Changed <changed@example.com>";
  await deliver(await lease(job.id));
  const actual = await refreshed(job.id);
  assert.equal(actual.status, "accepted"); assert.equal(actual.providerId, "synthetic-resend-message");
  assert.equal(payloads[0], payloads[1]); assert.equal(actual.attempts, 2);
  assert.equal(payloads[0].includes("Private synthetic body"), false);
  globalThis.fetch = originalFetch;
});
test("opt-out and cancellation suppress jobs before contacting a provider", async () => {
  const job = await notification();
  await db.update(accounts).set({ emailNotifications: false }).where(eq(accounts.id, clientId));
  await deliver(await lease(job.id)); assert.equal((await refreshed(job.id)).status, "skipped");
  await db.update(accounts).set({ emailNotifications: true }).where(eq(accounts.id, clientId));
  const c = await consultation(8 * MINUTE);
  await scheduleReminders(Date.now(), consultationIds); await queueOutbound([clientId, lawyerOwnerId]);
  const [n] = await db.select().from(notifications).where(eq(notifications.consultationId, c.id));
  const [reminder] = await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.notificationId, n.id));
  await db.update(consultations).set({ status: "cancelled" }).where(eq(consultations.id, c.id));
  await deliver(await lease(reminder.id));
  assert.equal((await refreshed(reminder.id)).status, "skipped");
});
test("Twilio room tokens are restricted to participants and record explicit consent", async () => {
  process.env.TWILIO_CALLS_ENABLED = "true";
  const c = await consultation(5 * MINUTE);
  await assert.rejects(issueCallAccess(await account(outsiderId), c.id), { status: 403 });
  const roomSid = `RM${"3".repeat(32)}`;
  const provider = nock("https://video.twilio.com")
    .post("/v1/Rooms", (body) => {
      assert.equal(String(body.RecordParticipantsOnConnect), "false"); assert.equal(String(body.MaxParticipants), "2"); return true;
    })
    .reply(201, { sid: roomSid, unique_name: "synthetic-room", status: "in-progress", record_participants_on_connect: false });
  const access = await issueCallAccess(await account(clientId), c.id);
  assert.equal(access.room, roomSid); assert.equal(access.recordingEnabled, false);
  const payload = JSON.parse(Buffer.from(access.token.split(".")[1], "base64url").toString());
  assert.equal(payload.grants.identity, clientId); assert.equal(payload.grants.video.room, roomSid);
  assert.ok(payload.exp - payload.iat <= 300);
  const consents = await db.select().from(callConsents).where(eq(callConsents.consultationId, c.id));
  assert.equal(consents.length, 1); assert.equal(consents[0].userId, clientId);
  assert.ok(provider.isDone());
});

test("competing workers claim distinct jobs and reclaim expired leases", async () => {
  await notification(); await notification();
  const claimed = await Promise.all([claimDelivery(Date.now(), [clientId]), claimDelivery(Date.now(), [clientId])]);
  assert.ok(claimed[0]); assert.ok(claimed[1]); assert.notEqual(claimed[0].id, claimed[1].id);
  await db.update(communicationDeliveries).set({ lockedUntil: new Date(Date.now() - MINUTE).toISOString(), nextAttemptAt: new Date(0).toISOString() })
    .where(eq(communicationDeliveries.id, claimed[0].id));
  const recovered = await claimDelivery(Date.now(), [clientId]);
  assert.equal(recovered?.id, claimed[0].id);
  assert.notEqual(recovered?.lockToken, claimed[0].lockToken);
});

test("push delivery tracks each browser separately and removes expired subscriptions", async () => {
  const vapid = webPush.generateVAPIDKeys(); // Ephemeral test-only cryptographic material.
  Object.assign(process.env, {
    PUSH_DELIVERY_ENABLED: "true", VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:fixture@example.com",
  });
  await db.update(accounts).set({ pushNotifications: true }).where(eq(accounts.id, clientId));
  const destinations = [randomUUID(), randomUUID()];
  for (const id of destinations) {
    await db.insert(pushSubscriptions).values({
      id, userId: clientId, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
      keys: { p256dh: webPush.generateVAPIDKeys().publicKey, auth: randomBytes(16).toString("base64url") },
    });
  }
  const emailJob = await notification();
  const jobs = await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.notificationId, emailJob.notificationId));
  const pushJobs = jobs.filter((j) => j.channel === "push");
  assert.equal(pushJobs.length, 2);
  const accepted = nock("https://fcm.googleapis.com").post(`/fcm/send/${destinations[0]}`).reply(201, "");
  const expired = nock("https://fcm.googleapis.com").post(`/fcm/send/${destinations[1]}`).reply(410, "");
  for (const job of pushJobs) await deliver(await lease(job.id));
  assert.equal((await refreshed(pushJobs.find((j) => j.destination === destinations[0])!.id)).status, "accepted");
  assert.equal((await refreshed(pushJobs.find((j) => j.destination === destinations[1])!.id)).status, "skipped");
  assert.equal((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, destinations[1]))).length, 0);
  await queueOutbound([clientId, lawyerOwnerId]);
  assert.equal((await db.select().from(communicationDeliveries).where(eq(communicationDeliveries.notificationId, emailJob.notificationId))).length, 3);
  assert.ok(accepted.isDone()); assert.ok(expired.isDone());
});
