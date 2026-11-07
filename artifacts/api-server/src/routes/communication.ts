import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, accounts, phoneChallenges, pushSubscriptions, communicationDeliveries } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { requireAccount, HttpError } from "../middlewares/access";
import { phoneVerificationEnabled, pushEnabled, callsEnabled } from "../lib/communication-config";
import { callEligibility, isParticipant, validPushEndpoint, phoneApproved, HOUR, MINUTE } from "../lib/communication-policy";
import { twilioClient, issueCallAccess } from "../lib/consultation-calls";
import { accessibleConsultation } from "../lib/legal";

const router: IRouter = Router();
router.use(["/me/phone", "/me/push-subscriptions", "/me/deliveries", "/consultations/:id/call"], requireAccount);
const callLimit = rateLimit({ windowMs: MINUTE, limit: 12, keyGenerator: (req) => req.account.id, standardHeaders: "draft-8", legacyHeaders: false });
const phoneLimit = rateLimit({ windowMs: HOUR, limit: 20, keyGenerator: (req) => req.account.id, standardHeaders: "draft-8", legacyHeaders: false });

router.get("/consultations/:id/call", async (req, res) => {
  const { id } = api.GetConsultationParams.parse(req.params);
  const c = await accessibleConsultation(req.account, id);
  if (!isParticipant(req.account, c)) throw new HttpError(403, "Only consultation participants can access calls.");
  res.set("Cache-Control", "no-store").json(api.GetConsultationCallResponse.parse(callEligibility(c, callsEnabled())));
});
router.post("/consultations/:id/call", callLimit, async (req, res) => {
  const { id } = api.GetConsultationParams.parse(req.params);
  const c = await accessibleConsultation(req.account, id);
  if (!isParticipant(req.account, c)) throw new HttpError(403, "Only consultation participants can access calls.");
  const consent = api.JoinConsultationCallBody.parse(req.body);
  if (!consent.microphoneConsent || !consent.recordingDisabledAcknowledged)
    throw new HttpError(400, "Explicit microphone consent and acknowledgement that recording is disabled are required.");
  res.set("Cache-Control", "no-store").json(api.JoinConsultationCallResponse.parse(await issueCallAccess(req.account, id)));
});

router.post("/me/phone/challenge", phoneLimit, async (req, res) => {
  const { phone } = api.RequestPhoneVerificationBody.parse(req.body);
  if (!phoneVerificationEnabled()) throw new HttpError(503, "Twilio phone verification is not configured. No SMS was sent.");
  // Durable per-account rate limits survive restarts. Hold the account lock while creating a challenge.
  const result = await db.transaction(async (tx) => {
    await tx.select().from(accounts).where(eq(accounts.id, req.account.id)).for("update");
    const [old] = await tx.select().from(phoneChallenges).where(eq(phoneChallenges.userId, req.account.id));
    const now = Date.now();
    const sameWindow = old && now - new Date(old.windowStart).getTime() < HOUR;
    if (old && now - new Date(old.lastSentAt).getTime() < MINUTE) return { error: "Wait at least a minute before requesting another code.", status: 429 };
    if (sameWindow && old.requests >= 5) return { error: "Hourly SMS verification limit reached.", status: 429 };
    // Also limit a destination across accounts, so sign-ups cannot bypass the cap.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`);
    const [total] = await tx.select({ count: sql<number>`coalesce(sum(${phoneChallenges.requests}), 0)::integer` })
      .from(phoneChallenges).where(and(eq(phoneChallenges.phone, phone),
        sql`${phoneChallenges.windowStart} > ${new Date(now - HOUR).toISOString()}`));
    if ((total?.count || 0) >= 5) return { error: "The hourly verification limit for this phone has been reached.", status: 429 };
    const expiresAt = new Date(now + 10 * MINUTE).toISOString();
    const values = {
      phone, providerSid: null, expiresAt, lastSentAt: new Date(now).toISOString(),
      windowStart: sameWindow ? old.windowStart : new Date(now).toISOString(),
      requests: sameWindow ? old.requests + 1 : 1, attempts: 0,
    };
    await tx.insert(phoneChallenges).values({ userId: req.account.id, ...values })
      .onConflictDoUpdate({ target: phoneChallenges.userId, set: values });
    try {
      const challenge = await twilioClient().verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID!)
        .verifications.create({ to: phone, channel: "sms" });
      if (challenge.status !== "pending") return { error: "The SMS provider did not accept the verification request.", status: 502 };
      await tx.update(phoneChallenges).set({ providerSid: challenge.sid }).where(eq(phoneChallenges.userId, req.account.id));
      return { maskedPhone: `••••${phone.slice(-4)}`, expiresAt };
    } catch { return { error: "The SMS provider could not send a code. Your phone has not been verified.", status: 502 }; }
  });
  if ("error" in result) throw new HttpError(result.status!, result.error!);
  res.json(api.RequestPhoneVerificationResponse.parse(result));
});
router.post("/me/phone/verify", phoneLimit, async (req, res) => {
  const { code } = api.ConfirmPhoneVerificationBody.parse(req.body);
  if (!phoneVerificationEnabled()) throw new HttpError(503, "Phone verification is not configured.");
  const result = await db.transaction(async (tx) => {
    await tx.select().from(accounts).where(eq(accounts.id, req.account.id)).for("update");
    const [c] = await tx.select().from(phoneChallenges).where(eq(phoneChallenges.userId, req.account.id));
    if (!c?.providerSid || new Date(c.expiresAt).getTime() <= Date.now() || c.attempts >= 5)
      return { error: "Request a fresh verification code.", status: 400 };
    await tx.update(phoneChallenges).set({ attempts: c.attempts + 1 }).where(eq(phoneChallenges.userId, req.account.id));
    try {
      const check = await twilioClient().verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID!)
        .verificationChecks.create({ verificationSid: c.providerSid, code });
      if (!phoneApproved(check, c.phone))
        return { error: "The code is invalid or expired. Your phone has not been verified.", status: 400 };
      const [account] = await tx.update(accounts).set({ phone: c.phone, phoneVerifiedAt: new Date().toISOString() })
        .where(eq(accounts.id, req.account.id)).returning();
      await tx.update(phoneChallenges).set({ providerSid: null }).where(eq(phoneChallenges.userId, req.account.id));
      return { account };
    } catch { return { error: "The provider could not verify this code. Your phone status has not changed.", status: 502 }; }
  });
  if ("error" in result) throw new HttpError(result.status!, result.error!);
  res.json(api.ConfirmPhoneVerificationResponse.parse(result.account));
});

router.post("/me/push-subscriptions", async (req, res) => {
  const input = api.SavePushSubscriptionBody.parse(req.body);
  if (!pushEnabled()) throw new HttpError(503, "Browser push is not configured.");
  if (!validPushEndpoint(input.endpoint) || !/^[A-Za-z0-9_-]+$/.test(input.keys.p256dh) || !/^[A-Za-z0-9_-]+$/.test(input.keys.auth) ||
    Buffer.from(input.keys.p256dh, "base64url").length !== 65 || Buffer.from(input.keys.auth, "base64url").length !== 16)
    throw new HttpError(400, "This browser push subscription is not supported.");
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, req.account.id));
    if (existing.length >= 10 && !existing.some((s) => s.endpoint === input.endpoint))
      throw new HttpError(409, "The limit of 10 browser subscriptions has been reached.");
    await tx.insert(pushSubscriptions).values({ ...input, id: randomUUID(), userId: req.account.id })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { keys: input.keys, userId: req.account.id } });
    await tx.update(accounts).set({ pushNotifications: true }).where(eq(accounts.id, req.account.id));
  });
  res.json({ ok: true });
});
router.delete("/me/push-subscriptions", async (req, res) => {
  const { endpoint } = api.RemovePushSubscriptionBody.parse(req.body);
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, req.account.id)));
  res.json({ ok: true });
});
router.get("/me/deliveries", async (req, res) => {
  const rows = await db.select({
    id: communicationDeliveries.id, channel: communicationDeliveries.channel, status: communicationDeliveries.status,
    attempts: communicationDeliveries.attempts, nextAttemptAt: communicationDeliveries.nextAttemptAt,
    lastError: communicationDeliveries.lastError, createdAt: communicationDeliveries.createdAt,
  }).from(communicationDeliveries).where(eq(communicationDeliveries.userId, req.account.id))
    .orderBy(desc(communicationDeliveries.createdAt)).limit(30);
  res.set("Cache-Control", "no-store").json(api.ListCommunicationDeliveriesResponse.parse(rows));
});

export default router;
