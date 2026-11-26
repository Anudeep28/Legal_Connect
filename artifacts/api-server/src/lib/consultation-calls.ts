import { randomUUID } from "node:crypto";
import twilio from "twilio";
import { and, eq, inArray } from "drizzle-orm";
import { db, consultations, lawyers, accounts, callConsents, callRecordingConsents, callRecordingSessions } from "@workspace/db";
import { HttpError, type Account } from "../middlewares/access";
import { callsEnabled, callRecordingEnabled, callRecordingCallbackUrl, twilioUsageLookupConfigured } from "./communication-config";
import { callEligibility, isParticipant } from "./communication-policy";
import { callFailureDetails, type CallPreparationStage } from "./call-diagnostics";
import { hasElevenLabsConnection } from "./ai-providers";
import { supportedLanguages } from "../data/languages";
import { logger } from "./logger";

export function twilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, { timeout: 10_000, autoRetry: false });
}

export type TwilioVideoUsageSnapshot = {
  status: "success" | "partial" | "no_data";
  spend: string | null;
  currency: string | null;
  participantMinutes: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  asOf: string | null;
};

export type TwilioVideoUsagePeriod = "thisMonth" | "lastMonth";

function usageDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function usageTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Reads Twilio's posted monthly Programmable Video total (pv) and the
 * Group Room participant-minute record. The total is provider-priced, not an
 * estimate derived from room duration or the published per-minute rate.
 */
export async function getTwilioVideoUsage(period: TwilioVideoUsagePeriod = "thisMonth"): Promise<TwilioVideoUsageSnapshot> {
  if (!twilioUsageLookupConfigured()) throw new Error("twilio_usage_not_configured");
  const usageRecords = twilioClient().usage.records;
  const options = {
    includeSubaccounts: false,
    pageSize: 1000,
    limit: 1000,
  };
  const records: Array<{
    category: string;
    startDate: Date;
    endDate: Date;
    asOf: string;
    usage: string;
    priceUnit: string;
    price: number;
  }> = period === "lastMonth"
    ? await usageRecords.lastMonth.list(options)
    : await usageRecords.thisMonth.list(options);
  const videoTotals = records.filter((record) => record.category === "pv");
  const participantRecords = records.filter((record) => record.category === "group-rooms-participant-minutes");
  const datedRecords = videoTotals.length ? videoTotals : participantRecords;
  const periodStart = usageDate(datedRecords[0]?.startDate);
  const periodEnd = usageDate(datedRecords[0]?.endDate);
  const asOf = datedRecords
    .map((record) => usageTimestamp(record.asOf))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  const participantValues = participantRecords.map((record) => Number(record.usage));
  const participantMinutes = participantValues.length && participantValues.every(Number.isFinite)
    ? participantValues.reduce((sum, value) => sum + value, 0).toFixed(4)
    : null;

  if (!videoTotals.length) {
    return {
      status: participantRecords.length ? "partial" : "no_data",
      spend: null,
      currency: null,
      participantMinutes,
      periodStart,
      periodEnd,
      asOf,
    };
  }

  const currencies = new Set(videoTotals.map((record) => record.priceUnit.trim().toUpperCase()));
  const prices = videoTotals.map((record) => Number(record.price));
  if (currencies.size !== 1 || [...currencies][0]?.length !== 3 || prices.some((price) => !Number.isFinite(price)))
    throw new Error("twilio_usage_record_invalid");

  return {
    status: "success",
    spend: prices.reduce((sum, price) => sum + price, 0).toFixed(6),
    currency: [...currencies][0],
    participantMinutes,
    periodStart,
    periodEnd,
    asOf,
  };
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

export async function saveCallRecordingLanguage(account: Account, consultationId: string, languageCode: string) {
  if (!callRecordingEnabled()) throw new HttpError(503, "Call recording is not available; the call will remain unrecorded.");
  if (languageCode !== "auto" && !supportedLanguages.some((language) => language.code === languageCode))
    throw new HttpError(400, "Select a supported conversation language.");
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(consultations).where(eq(consultations.id, consultationId)).for("update");
    if (!c) throw new HttpError(404, "Consultation not found.");
    const [lawyer] = await tx.select().from(lawyers).where(eq(lawyers.id, c.lawyerId));
    if (!lawyer || lawyer.ownerId !== account.id)
      throw new HttpError(403, "Only the assigned lawyer can select the recording language.");
    if (c.callRecordingMode !== "pending" || c.callRoomSid)
      throw new HttpError(409, "The recording language can only be changed before the call starts.");
    await tx.update(consultations).set({ callRecordingLanguageCode: languageCode })
      .where(eq(consultations.id, consultationId));
    return { languageCode };
  });
}

export async function issueCallAccess(
  account: Account,
  id: string,
  options: { hasTranscriptionConnection?: () => Promise<boolean> } = {},
) {
  if (!callsEnabled()) throw new HttpError(503, "Twilio calling is not configured. No call was placed.");
  const hasTranscriptionConnection = options.hasTranscriptionConnection ?? hasElevenLabsConnection;
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
          if (!callRecordingCallbackUrl()) throw new HttpError(503, "Secure recording callbacks are not configured. The call remains unrecorded.");
          if (!await hasTranscriptionConnection()) throw new HttpError(503, "ElevenLabs transcription is unavailable. No recording call was started.");
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
        } else {
          if (!callRecordingCallbackUrl()) throw new HttpError(503, "Secure recording callbacks are not configured. The call remains unrecorded.");
          if (!await hasTranscriptionConnection()) throw new HttpError(503, "ElevenLabs transcription is unavailable. No recording call was started.");
          shouldRecord = true;
        }
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
          audioOnly: true,
          ...(shouldRecord ? { statusCallback: callRecordingCallbackUrl()!, statusCallbackMethod: "POST" as const } : {}),
          maxParticipantDuration: Math.max(1, Math.ceil((new Date(c.endsAt).getTime() - Date.now()) / 1000)),
          emptyRoomTimeout: 5, unusedRoomTimeout: 5,
        });
        stage = "save-room";
        await tx.update(consultations).set({ callRoomSid: room.sid }).where(eq(consultations.id, id));
        if (shouldRecord) {
          await tx.insert(callRecordingSessions).values({
            id: randomUUID(),
            consultationId: id,
            roomSid: room.sid,
            languageCode: c.callRecordingLanguageCode || "auto",
          }).onConflictDoNothing({ target: callRecordingSessions.roomSid });
        }
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
