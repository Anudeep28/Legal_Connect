import { randomUUID } from "node:crypto";
import twilio from "twilio";
import { and, eq, inArray } from "drizzle-orm";
import { db, consultations, lawyers, accounts, callConsents, callRecordingConsents } from "@workspace/db";
import { HttpError, type Account } from "../middlewares/access";
import { callsEnabled, callRecordingEnabled } from "./communication-config";
import { callEligibility, isParticipant } from "./communication-policy";
import { callFailureDetails, type CallPreparationStage } from "./call-diagnostics";
import { logger } from "./logger";

export function twilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, { timeout: 10_000, autoRetry: false });
}

async function recordingConsentState(account: Account, consultationId: string, mode: "pending" | "recorded" | "unrecorded") {
  if (!callRecordingEnabled()) return { enabled: false, mode: "unrecorded" as const, myConsent: null, otherConsent: null };
  const [c] = await db.select().from(consultations).where(eq(consultations.id, consultationId));
  const [lawyer] = c ? await db.select().from(lawyers).where(eq(lawyers.id, c.lawyerId)) : [];
  const otherId = c?.userId === account.id ? lawyer?.ownerId : c?.lawyerId ? c.userId : undefined;
  if (!c || !lawyer || !otherId) return { enabled: true, mode, myConsent: null, otherConsent: null };
  const rows = await db.select().from(callRecordingConsents).where(eq(callRecordingConsents.consultationId, consultationId));
  return {
    enabled: true,
    mode,
    myConsent: rows.find((row) => row.userId === account.id)?.consent ?? null,
    otherConsent: rows.find((row) => row.userId === otherId)?.consent ?? null,
  };
}

export async function getCallRecordingConsentState(account: Account, consultationId: string) {
  const [c] = await db.select().from(consultations).where(eq(consultations.id, consultationId));
  if (!c) throw new HttpError(404, "Consultation not found.");
  const [lawyer] = await db.select().from(lawyers).where(eq(lawyers.id, c.lawyerId));
  if (!lawyer || !isParticipant(account, { userId: c.userId, lawyerOwnerId: lawyer.ownerId }))
    throw new HttpError(403, "Only consultation participants can view recording choices.");
  return recordingConsentState(account, c.id, c.callRecordingMode);
}

export async function saveCallRecordingConsent(account: Account, consultationId: string, consent: boolean, stopCall = false) {
  if (stopCall && consent) throw new HttpError(400, "A call can only be force-stopped while declining or withdrawing recording.");
  const recordingFeatureEnabled = callRecordingEnabled();
  if (!recordingFeatureEnabled && consent)
    throw new HttpError(503, "Optional call recording is not enabled. The call remains unrecorded.");
  let closeRoomAfterCommit = false;
  const mode = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(consultations).where(eq(consultations.id, consultationId)).for("update");
    if (!c) throw new HttpError(404, "Consultation not found.");
    const [lawyer] = await tx.select().from(lawyers).where(eq(lawyers.id, c.lawyerId));
    if (!lawyer || !isParticipant(account, { userId: c.userId, lawyerOwnerId: lawyer.ownerId }))
      throw new HttpError(403, "Only the client and assigned lawyer can choose call recording.");
    if (consent) {
      const eligibility = callEligibility(c, callsEnabled());
      if (!eligibility.canJoin) throw new HttpError(409, eligibility.reason);
    }
    if (c.callRecordingMode === "unrecorded" && consent)
      throw new HttpError(409, "This consultation is set to continue without recording.");
    if (c.callRecordingMode === "recorded" && consent)
      return c.callRecordingMode;

    const now = new Date().toISOString();
    await tx.insert(callRecordingConsents).values({
      id: randomUUID(), consultationId, userId: account.id, consent,
      policyVersion: "call-recording-consent-v1", createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [callRecordingConsents.consultationId, callRecordingConsents.userId],
      set: { consent, policyVersion: "call-recording-consent-v1", updatedAt: now },
    });

    if (!consent) {
      closeRoomAfterCommit = Boolean(c.callRoomSid && (c.callRecordingMode === "recorded" || stopCall));
      await tx.update(consultations).set({
        callRecordingMode: "unrecorded",
        callRecordingStopPending: closeRoomAfterCommit,
      }).where(eq(consultations.id, consultationId));
      return "unrecorded" as const;
    }
    return c.callRecordingMode;
  });

  if (closeRoomAfterCommit) {
    try {
      await closeCallRoom(consultationId);
    } catch {
      throw new HttpError(503, "Your withdrawal was saved and the call was disconnected. Twilio room closure is being retried.");
    }
  }
  return recordingConsentState(account, consultationId, mode);
}

export async function issueCallAccess(account: Account, id: string) {
  if (!callsEnabled()) throw new HttpError(503, "Twilio calling is not configured. No call was placed.");
  return db.transaction(async (tx) => {
    // Serialize room creation against acceptance/cancellation and concurrent joins.
    const [c] = await tx.select().from(consultations).where(eq(consultations.id, id)).for("update");
    if (!c) throw new HttpError(404, "Consultation not found.");
    if (c.callRecordingStopPending) throw new HttpError(409, "Recording is being stopped. Please wait before rejoining.");
    const [lawyer] = await tx.select().from(lawyers).where(eq(lawyers.id, c.lawyerId));
    if (!lawyer || !isParticipant(account, { userId: c.userId, lawyerOwnerId: lawyer.ownerId }))
      throw new HttpError(403, "Only the client and assigned lawyer can join this call.");
    const participants = await tx.select().from(accounts).where(inArray(accounts.id, [c.userId, lawyer.ownerId || ""]));
    if (participants.length !== 2 || participants.some((a) => a.status !== "active") || lawyer.approvalStatus !== "approved")
      throw new HttpError(409, "Both participants must be active and the assigned lawyer must be approved.");
    const eligibility = callEligibility(c, true);
    if (!eligibility.canJoin) throw new HttpError(409, eligibility.reason);
    let shouldRecord = false;
    if (callRecordingEnabled()) {
      const choices = await tx.select().from(callRecordingConsents).where(eq(callRecordingConsents.consultationId, id));
      const clientChoice = choices.find((choice) => choice.userId === c.userId)?.consent;
      const lawyerChoice = choices.find((choice) => choice.userId === lawyer.ownerId)?.consent;
      if (c.callRecordingMode === "pending") {
        if (clientChoice === true && lawyerChoice === true) {
          await tx.update(consultations).set({ callRecordingMode: "recorded" }).where(eq(consultations.id, id));
          shouldRecord = true;
        } else if (clientChoice === false || lawyerChoice === false) {
          await tx.update(consultations).set({ callRecordingMode: "unrecorded" }).where(eq(consultations.id, id));
        } else {
          throw new HttpError(409, "Both participants must explicitly choose recording, or one must choose to continue unrecorded.");
        }
      } else if (c.callRecordingMode === "recorded") {
        if (clientChoice !== true || lawyerChoice !== true) {
          await tx.update(consultations).set({ callRecordingMode: "unrecorded" }).where(eq(consultations.id, id));
        } else shouldRecord = true;
      }
    } else if (c.callRecordingMode === "recorded") {
      // Turning off the feature flag also prevents any further recording rooms.
      await tx.update(consultations).set({ callRecordingMode: "unrecorded" }).where(eq(consultations.id, id));
    }
    let stage: CallPreparationStage = "initialize-client";
    try {
      const client = twilioClient();
      stage = "fetch-room";
      let room = c.callRoomSid ? await client.video.v1.rooms(c.callRoomSid).fetch() : null;
      if (!room || room.status === "completed") {
        // A unique name per attempt prevents public room links and client-created room names.
        stage = "create-room";
        room = await client.video.v1.rooms.create({
          uniqueName: `consultation-${randomUUID()}`, type: "group",
          maxParticipants: 2, recordParticipantsOnConnect: shouldRecord,
          maxParticipantDuration: Math.max(1, Math.ceil((new Date(c.endsAt).getTime() - Date.now()) / 1000)),
          emptyRoomTimeout: 5, unusedRoomTimeout: 5,
        });
        stage = "save-room";
        await tx.update(consultations).set({ callRoomSid: room.sid }).where(eq(consultations.id, id));
      }
      if (room.recordParticipantsOnConnect !== shouldRecord) {
        stage = "close-recording-room";
        await client.video.v1.rooms(room.sid).update({ status: "completed" });
        if (room.recordParticipantsOnConnect || shouldRecord)
          throw new HttpError(503, "The provider room's recording mode did not match both participants' consent. Joining is blocked.");
        throw new HttpError(503, "Recording is unexpectedly enabled at the provider. Joining is blocked.");
      }
      const ttl = Math.max(1, Math.min(300, Math.floor((new Date(c.endsAt).getTime() - Date.now()) / 1000)));
      stage = "sign-token";
      const token = new twilio.jwt.AccessToken(
        process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!,
        { identity: account.id, ttl },
      );
      token.addGrant(new twilio.jwt.AccessToken.VideoGrant({ room: room.sid }));
      const signedToken = token.toJwt();
      stage = "save-consent";
      await tx.insert(callConsents).values({ id: randomUUID(), consultationId: id, userId: account.id });
      return { token: signedToken, room: room.sid, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), closesAt: c.endsAt, recordingEnabled: shouldRecord };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const failure = callFailureDetails(error, stage, randomUUID());
      logger.error(failure.log, "Call preparation failed");
      throw new HttpError(502, failure.message);
    }
  });
}

export async function closeCallRoom(id: string) {
  const [c] = await db.select().from(consultations).where(eq(consultations.id, id));
  if (!c?.callRoomSid) {
    await db.update(consultations).set({ callRecordingStopPending: false }).where(eq(consultations.id, id));
    return;
  }
  try { await twilioClient().video.v1.rooms(c.callRoomSid).update({ status: "completed" }); }
  catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
  await db.update(consultations).set({ callRoomSid: null }).where(
    and(eq(consultations.id, id), eq(consultations.callRoomSid, c.callRoomSid)),
  );
  await db.update(consultations).set({ callRecordingStopPending: false }).where(eq(consultations.id, id));
}
