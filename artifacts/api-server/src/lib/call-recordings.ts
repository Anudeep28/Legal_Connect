import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { Request, Response as ExpressResponse } from "express";
import { and, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import twilio from "twilio";
import {
  db, accounts, callRecordingConsents, callRecordingSessions, callRecordingTracks,
  consultations, lawyers, type CallTranscriptWord,
} from "@workspace/db";
import { ensureCompatibleAudio } from "./audio";
import { transcribeCallTrackWithElevenLabs } from "./ai-providers";
import { publicAppUrl } from "./communication-config";
import { twilioClient } from "./consultation-calls";
import { getLanguageByCode } from "../data/languages";
import { logger } from "./logger";
import { reserveAiAttempt } from "./ai-usage";

const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS = 100_000;
const MAX_TRANSCRIPTION_ATTEMPTS = 3;
export const CALL_AUDIO_RETENTION_MS = 24 * 60 * 60_000;
const ROOM_RECORDING_CALLBACK = "/api/communications/twilio-video-recordings";

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validSid(value: string, prefix: "RM" | "RT") {
  return new RegExp(`^${prefix}[0-9a-fA-F]{32}$`).test(value);
}

export function callRecordingCallbackUrl() {
  const base = publicAppUrl();
  return base ? `${base}${ROOM_RECORDING_CALLBACK}` : null;
}

export function validateTwilioVideoSignature(input: {
  signature: string | undefined;
  url: string;
  params: Record<string, unknown>;
  authToken?: string;
}) {
  if (!input.signature || !input.authToken) return false;
  try {
    const params = Object.fromEntries(Object.entries(input.params).map(([key, value]) => [key, String(value)]));
    return twilio.validateRequest(input.authToken, input.signature, input.url, params);
  } catch {
    return false;
  }
}

async function removeTwilioRecording(recordingSid: string) {
  try {
    await twilioClient().video.v1.recordings(recordingSid).remove();
  } catch (error) {
    if ((error as { status?: number }).status === 404) return;
    throw error;
  }
}

async function storeTwilioCallback(body: Record<string, unknown>) {
  const event = stringValue(body.StatusCallbackEvent || body.Event).toLowerCase();
  const roomSid = stringValue(body.RoomSid);
  if (!validSid(roomSid, "RM")) return;
  const [session] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.roomSid, roomSid));
  if (!session) {
    const recordingSid = stringValue(body.RecordingSid);
    if (validSid(recordingSid, "RT") && event === "recording-completed") {
      await removeTwilioRecording(recordingSid);
    }
    return;
  }

  if (event === "room-ended") {
    await db.update(callRecordingSessions).set({
      roomEndedAt: session.roomEndedAt ?? new Date().toISOString(),
      status: ["ready", "failed", "withdrawn"].includes(session.status) ? session.status : "processing",
    }).where(eq(callRecordingSessions.id, session.id));
    return;
  }

  const recordingSid = stringValue(body.RecordingSid);
  if (!validSid(recordingSid, "RT")) return;

  if (event === "recording-failed") {
    await db.update(callRecordingSessions).set({ status: "failed", processingError: "recording_failed" })
      .where(eq(callRecordingSessions.id, session.id));
    return;
  }
  if (event !== "recording-completed") return;

  const [consultation] = await db.select().from(consultations).where(eq(consultations.id, session.consultationId));
  const [lawyer] = consultation ? await db.select().from(lawyers).where(eq(lawyers.id, consultation.lawyerId)) : [];
  let identity = stringValue(body.ParticipantIdentity);
  const participantSid = stringValue(body.ParticipantSid);
  if (!identity && /^PA[0-9a-fA-F]{32}$/.test(participantSid)) {
    try {
      const participant = await twilioClient().video.v1.rooms(roomSid).participants(participantSid).fetch();
      identity = participant.identity;
    } catch {
      throw new Error("participant_identity_lookup_failed");
    }
  }
  const speaker = identity === consultation?.userId ? "client" : identity && identity === lawyer?.ownerId ? "lawyer" : null;
  const trackKind = stringValue(body.TrackKind).toLowerCase();
  const container = stringValue(body.Container).toLowerCase();
  if (!consultation || !lawyer || !speaker ||
    (trackKind && trackKind !== "audio") ||
    (container && container !== "mka")) {
    await removeTwilioRecording(recordingSid);
    return;
  }

  const consentRows = await db.select().from(callRecordingConsents)
    .where(eq(callRecordingConsents.consultationId, consultation.id));
  const mutualConsent = consultation.callRecordingMode === "recorded" &&
    consentRows.some((row) => row.userId === consultation.userId && row.consent) &&
    consentRows.some((row) => row.userId === lawyer.ownerId && row.consent);
  const [participant] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, identity));
  if (!participant) {
    await removeTwilioRecording(recordingSid);
    return;
  }

  await db.insert(callRecordingTracks).values({
    id: randomUUID(),
    sessionId: session.id,
    recordingSid,
    participantId: identity,
    speaker,
    trackSid: stringValue(body.SourceSid) || null,
    status: mutualConsent ? "queued" : "failed_delete_pending",
    lastError: mutualConsent ? "" : "consent_withdrawn",
  }).onConflictDoNothing({ target: callRecordingTracks.recordingSid });
}

export async function twilioVideoRecordingWebhook(req: Request, res: ExpressResponse) {
  const base = publicAppUrl();
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const url = base ? `${base}${req.originalUrl.split("?")[0]}` : "";
  const valid = validateTwilioVideoSignature({
    signature: req.header("X-Twilio-Signature"),
    url,
    params: req.body ?? {},
    authToken,
  });
  if (!valid) {
    res.status(403).end();
    return;
  }
  const accountSid = stringValue(req.body?.AccountSid);
  if (!accountSid || accountSid !== process.env.TWILIO_ACCOUNT_SID) {
    res.status(403).end();
    return;
  }
  try {
    await storeTwilioCallback(req.body ?? {});
    res.status(204).end();
  } catch {
    logger.error("Twilio recording callback could not be saved; provider retries are expected");
    res.status(500).end();
  }
}

async function readLimited(response: globalThis.Response, maxBytes: number) {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error("recording_too_large");
  if (!response.body) throw new Error("recording_body_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("recording_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function downloadTwilioRecording(recordingSid: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("twilio_not_configured");
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(`https://video.twilio.com/v1/Recordings/${encodeURIComponent(recordingSid)}/Media`, {
    headers: { authorization: `Basic ${credentials}` },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("recording_download_failed");
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== "https:" || !["video.twilio.com", "media.twiliocdn.com"].includes(finalUrl.hostname)) {
    throw new Error("recording_media_host_rejected");
  }
  return readLimited(response, MAX_RECORDING_BYTES);
}

async function claimTrack(now = Date.now()) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select({ track: callRecordingTracks, session: callRecordingSessions })
      .from(callRecordingTracks)
      .innerJoin(callRecordingSessions, eq(callRecordingTracks.sessionId, callRecordingSessions.id))
      .where(and(or(
        inArray(callRecordingTracks.status, ["transcribed_delete_pending", "failed_delete_pending"]),
        and(eq(callRecordingTracks.status, "queued"), isNotNull(callRecordingSessions.roomEndedAt)),
        and(inArray(callRecordingTracks.status, ["processing", "processing_delete_pending"]),
          lte(callRecordingTracks.updatedAt, new Date(now - 5 * 60_000).toISOString())),
      )))
      .orderBy(callRecordingTracks.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const staleDelete = candidate.track.status === "processing_delete_pending";
    const deleteStatus = candidate.track.status === "transcribed_delete_pending" ||
      (staleDelete && candidate.track.transcriptWords.length > 0)
      ? "transcribed_delete_pending" as const
      : candidate.track.status === "failed_delete_pending" || staleDelete
        ? "failed_delete_pending" as const : null;
    const action = deleteStatus ? "delete" as const : "transcribe" as const;
    await tx.update(callRecordingTracks).set({
      status: action === "delete" ? "processing_delete_pending" : "processing",
      updatedAt: new Date(now).toISOString(),
    }).where(eq(callRecordingTracks.id, candidate.track.id));
    return { ...candidate, action, deleteStatus, track: { ...candidate.track, status: action === "delete" ? "processing_delete_pending" : "processing" } };
  });
}

function makeTranscriptWords(
  result: Awaited<ReturnType<typeof transcribeCallTrackWithElevenLabs>>,
  track: Pick<typeof callRecordingTracks.$inferSelect, "speaker">,
  offsetMs: number,
): CallTranscriptWord[] {
  const offsetSeconds = Math.max(0, offsetMs) / 1000;
  const words = result.words.map((word) => ({
    text: word.text,
    startSeconds: offsetSeconds + word.startSeconds,
    endSeconds: offsetSeconds + word.endSeconds,
    speaker: track.speaker,
    ...(word.languageCode || result.languageCode ? { languageCode: word.languageCode ?? result.languageCode! } : {}),
  }));
  if (words.length) return words;
  return [{
    text: result.text,
    startSeconds: offsetSeconds,
    endSeconds: offsetSeconds,
    speaker: track.speaker,
    ...(result.languageCode ? { languageCode: result.languageCode } : {}),
  }];
}

export function formatCallTranscript(words: CallTranscriptWord[]) {
  const sorted = [...words].sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  const groups: Array<{ speaker: CallTranscriptWord["speaker"]; languageCode?: string; start: number; end: number; words: string[] }> = [];
  for (const word of sorted) {
    const group = groups.at(-1);
    if (group && group.speaker === word.speaker && group.languageCode === word.languageCode &&
      word.startSeconds - group.end <= 2.5) {
      group.words.push(word.text);
      group.end = Math.max(group.end, word.endSeconds);
    } else {
      groups.push({
        speaker: word.speaker, languageCode: word.languageCode, start: word.startSeconds,
        end: word.endSeconds, words: [word.text],
      });
    }
  }
  return groups.map((group) => {
    const seconds = Math.floor(group.start);
    const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    const language = group.languageCode ? getLanguageByCode(group.languageCode)?.nativeName ?? group.languageCode : "";
    const label = group.speaker === "lawyer" ? "Lawyer" : "Client";
    const suffix = language ? ` (${language})` : "";
    return `[${time}] ${label}${suffix}: ${group.words.join(" ").replace(/\s+([,.;!?])/g, "$1")}`;
  }).join("\n\n");
}

async function finishSessionIfReady(sessionId: string) {
  const [session] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, sessionId));
  if (!session || !session.roomEndedAt || !session.inventoryComplete || ["ready", "failed", "withdrawn"].includes(session.status)) return;
  const tracks = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.sessionId, sessionId));
  if (!tracks.length) {
    await db.update(callRecordingSessions).set({ status: "failed", processingError: "no_audio_tracks" })
      .where(eq(callRecordingSessions.id, sessionId));
    return;
  }
  if (tracks.some((track) => !["transcribed", "failed"].includes(track.status))) return;
  const transcribed = tracks.filter((track) => track.status === "transcribed");
  if (!transcribed.length || tracks.some((track) => track.status === "failed")) {
    await db.update(callRecordingSessions).set({ status: "failed", processingError: "transcription_incomplete" })
      .where(eq(callRecordingSessions.id, sessionId));
    return;
  }
  const origin = Math.min(...transcribed.map((track) => track.mediaOffsetMs)) / 1000;
  const words = transcribed.flatMap((track) => track.transcriptWords.map((word) => ({
    ...word, startSeconds: Math.max(0, word.startSeconds - origin), endSeconds: Math.max(0, word.endSeconds - origin),
  })));
  const transcript = formatCallTranscript(words);
  if (!transcript || transcript.length > MAX_TRANSCRIPT_CHARS) {
    await db.update(callRecordingSessions).set({ status: "failed", processingError: "transcript_invalid" })
      .where(eq(callRecordingSessions.id, sessionId));
    return;
  }
  const detectedLanguages = [...new Set(transcribed.flatMap((track) => [
    track.detectedLanguage,
    ...track.transcriptWords.map((word) => word.languageCode ?? null),
  ]).filter((language): language is string => Boolean(language)))];
  await db.update(callRecordingSessions).set({
    status: "ready",
    generatedTranscript: transcript,
    editedTranscript: transcript,
    detectedLanguages,
    processingError: "",
    updatedAt: new Date().toISOString(),
  }).where(eq(callRecordingSessions.id, sessionId));
}

export async function processCallRecordingQueue(
  limit = 5,
  options: { transcribe?: typeof transcribeCallTrackWithElevenLabs } = {},
) {
  for (let count = 0; count < limit; count++) {
    const claimed = await claimTrack();
    if (!claimed) return;
    const { track, session } = claimed;
    if (claimed.action === "delete" && claimed.deleteStatus) {
      try {
        await removeTwilioRecording(track.recordingSid);
        const status = claimed.deleteStatus === "transcribed_delete_pending" ? "transcribed" : "failed";
        await db.update(callRecordingTracks).set({
          status,
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).where(eq(callRecordingTracks.id, track.id));
        if (status === "failed") {
          const withdrawn = track.lastError === "consent_withdrawn";
          await db.update(callRecordingSessions).set({
            status: withdrawn ? "withdrawn" : "failed",
            processingError: track.lastError || "transcription_failed",
          })
            .where(eq(callRecordingSessions.id, session.id));
        }
      } catch {
        await db.update(callRecordingTracks).set({
          updatedAt: new Date().toISOString(),
          status: claimed.deleteStatus,
          lastError: "media_deletion_pending",
        }).where(eq(callRecordingTracks.id, track.id));
      }
      await finishSessionIfReady(session.id);
      continue;
    }

    try {
      const [consultation] = await db.select().from(consultations).where(eq(consultations.id, session.consultationId));
      const consentRows = await db.select().from(callRecordingConsents).where(eq(callRecordingConsents.consultationId, session.consultationId));
      const [lawyer] = consultation ? await db.select().from(lawyers).where(eq(lawyers.id, consultation.lawyerId)) : [];
      const mutualConsent = consultation?.callRecordingMode === "recorded" &&
        consultation.status !== "cancelled" && lawyer &&
        consentRows.some((row) => row.userId === consultation.userId && row.consent) &&
        consentRows.some((row) => row.userId === lawyer.ownerId && row.consent);
      const expired = Date.now() - new Date(session.createdAt).getTime() >= CALL_AUDIO_RETENTION_MS;
      if (!mutualConsent || session.status === "withdrawn" || expired) {
        await db.update(callRecordingTracks).set({
          status: "failed_delete_pending", lastError: expired ? "retention_expired" : "consent_withdrawn", updatedAt: new Date().toISOString(),
        }).where(eq(callRecordingTracks.id, track.id));
        await db.update(callRecordingSessions).set({
          status: expired ? "failed" : "withdrawn", processingError: expired ? "retention_expired" : "consent_withdrawn", updatedAt: new Date().toISOString(),
        }).where(eq(callRecordingSessions.id, session.id));
        continue;
      }

      const recording = await twilioClient().video.v1.recordings(track.recordingSid).fetch();
      if (recording.status !== "completed") {
        await db.update(callRecordingTracks).set({ status: "queued", updatedAt: new Date().toISOString() })
          .where(eq(callRecordingTracks.id, track.id));
        continue;
      }
      const processed = await transcribePersistThenDelete(
        async () => {
          const lawyerOwnerId = lawyer?.ownerId;
          if (!lawyerOwnerId) throw new Error("lawyer_owner_missing");
          await reserveAiAttempt(lawyerOwnerId, "transcription");
          const raw = await downloadTwilioRecording(track.recordingSid);
          const compatible = await ensureCompatibleAudio(raw);
          if (compatible.buffer.length > MAX_RECORDING_BYTES) throw new Error("recording_too_large");
          const secondaryLanguageCodes = ["en", "mr"].filter((code) => code !== session.languageCode);
          const result = await (options.transcribe ?? transcribeCallTrackWithElevenLabs)(compatible.buffer, compatible.format, {
            languageCode: session.languageCode,
            secondaryLanguageCodes,
          });
          if (result.text.length > MAX_TRANSCRIPT_CHARS) throw new Error("transcript_too_large");
          return {
            result,
            transcriptWords: makeTranscriptWords(result, track, Number(recording.offset) || 0),
          };
        },
        async ({ result, transcriptWords }) => {
          await db.transaction(async (tx) => {
            // Consent may have been withdrawn while the provider was transcribing.
            // Serialize saving against the same consultation lock used by withdrawal.
            const [current] = await tx.select().from(consultations)
              .where(eq(consultations.id, session.consultationId)).for("update");
            const choices = await tx.select().from(callRecordingConsents)
              .where(eq(callRecordingConsents.consultationId, session.consultationId));
            if (current?.callRecordingMode !== "recorded" || current.status === "cancelled" ||
              !choices.some((choice) => choice.userId === current.userId && choice.consent) ||
              !choices.some((choice) => choice.userId === lawyer?.ownerId && choice.consent)) {
              throw new Error("consent_withdrawn");
            }
            await tx.update(callRecordingTracks).set({
            status: "transcribed_delete_pending",
            mediaOffsetMs: Number(recording.offset) || 0,
            durationSeconds: Number(recording.duration) || null,
            detectedLanguage: result.languageCode,
            transcriptWords,
            transcribedAt: new Date().toISOString(),
            attempts: track.attempts + 1,
            lastError: "",
            updatedAt: new Date().toISOString(),
            }).where(eq(callRecordingTracks.id, track.id));
          });
        },
        () => removeTwilioRecording(track.recordingSid),
      );
      if (!processed.deletePending) {
        await db.update(callRecordingTracks).set({
          status: "transcribed",
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).where(eq(callRecordingTracks.id, track.id));
      }
    } catch (error) {
      const attempts = track.attempts + 1;
      const quotaExceeded = (error as { status?: number }).status === 429;
      const consentWithdrawn = (error as Error).message === "consent_withdrawn";
      const terminal = attempts >= MAX_TRANSCRIPTION_ATTEMPTS || consentWithdrawn || quotaExceeded;
      await db.update(callRecordingTracks).set({
        status: terminal ? "failed_delete_pending" : "queued",
        attempts,
        lastError: quotaExceeded ? "daily_usage_limit" : consentWithdrawn ? "consent_withdrawn" : terminal ? "transcription_failed" : "provider_retry",
        updatedAt: new Date().toISOString(),
      }).where(eq(callRecordingTracks.id, track.id));
      if (terminal) {
        await db.update(callRecordingSessions).set({
          status: consentWithdrawn ? "withdrawn" : "failed",
          processingError: quotaExceeded ? "daily_usage_limit" : consentWithdrawn ? "consent_withdrawn" : "transcription_failed",
          updatedAt: new Date().toISOString(),
        }).where(eq(callRecordingSessions.id, session.id));
      }
      logger.warn({ recordingSid: track.recordingSid, attempt: attempts, errorName: (error as Error).name }, "Call track transcription attempt failed");
    }
    await finishSessionIfReady(session.id);
  }
}

export async function transcribePersistThenDelete<T>(
  transcribe: () => Promise<T>,
  persist: (result: T) => Promise<void>,
  deleteRawAudio: () => Promise<void>,
): Promise<{ result: T; deletePending: boolean }> {
  const result = await transcribe();
  await persist(result);
  try {
    await deleteRawAudio();
    return { result, deletePending: false };
  } catch {
    return { result, deletePending: true };
  }
}

// Callbacks can arrive out of order or be missed. A completed-room inventory is
// required before declaring a transcript complete, and also recovers missed media.
export async function reconcileCallRecordingSessions(now = Date.now()) {
  const sessions = await db.select().from(callRecordingSessions).where(and(
    eq(callRecordingSessions.inventoryComplete, false),
    lte(callRecordingSessions.updatedAt, new Date(now - 60_000).toISOString()),
  )).orderBy(callRecordingSessions.updatedAt).limit(5);
  for (const session of sessions) {
    try {
      const client = twilioClient();
      const [consultation] = await db.select().from(consultations).where(eq(consultations.id, session.consultationId));
      const expired = now - new Date(session.createdAt).getTime() >= CALL_AUDIO_RETENTION_MS;
      const discard = expired || consultation?.callRecordingMode !== "recorded" || consultation.status === "cancelled";
      let room = await client.video.v1.rooms(session.roomSid).fetch();
      if (discard && room.status !== "completed") room = await client.video.v1.rooms(session.roomSid).update({ status: "completed" });
      if (room.status !== "completed") {
        await db.update(callRecordingSessions).set({ updatedAt: new Date(now).toISOString() }).where(eq(callRecordingSessions.id, session.id));
        continue;
      }
      const recordings = await client.video.v1.recordings.list({ groupingSid: [session.roomSid], pageSize: 100 });
      let complete = true;
      let inventoryFailed = false;
      for (const recording of recordings) {
        if (recording.status === "processing") { complete = false; continue; }
        if (discard || recording.type !== "audio") {
          if (recording.status !== "deleted") await removeTwilioRecording(recording.sid);
          await db.update(callRecordingTracks).set({
            status: "failed", lastError: expired ? "retention_expired" : "consent_withdrawn",
            deletedAt: new Date(now).toISOString(),
          }).where(eq(callRecordingTracks.recordingSid, recording.sid));
          continue;
        }
        if (recording.status === "completed") {
          await storeTwilioCallback({
            StatusCallbackEvent: "recording-completed", RoomSid: session.roomSid,
            RecordingSid: recording.sid, ParticipantSid: recording.groupingSids?.participant_sid,
            SourceSid: recording.sourceSid, TrackKind: "audio", Container: recording.containerFormat,
          });
        } else {
          const [known] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.recordingSid, recording.sid));
          if (!known?.transcribedAt) {
            inventoryFailed = true;
            await db.update(callRecordingSessions).set({ status: "failed", processingError: "recording_unavailable" })
              .where(eq(callRecordingSessions.id, session.id));
          }
        }
      }
      await db.update(callRecordingSessions).set({
        inventoryComplete: complete, roomEndedAt: session.roomEndedAt ?? new Date(now).toISOString(),
        ...(discard ? { status: expired ? "failed" as const : "withdrawn" as const } : inventoryFailed ? { status: "failed" as const } : session.status === "recording" ? { status: "processing" as const } : {}),
        updatedAt: new Date(now).toISOString(),
      }).where(eq(callRecordingSessions.id, session.id));
      await finishSessionIfReady(session.id);
    } catch {
      // Do not mark the inventory complete or forget media when discovery/deletion fails.
      await db.update(callRecordingSessions).set({ updatedAt: new Date(now).toISOString() })
        .where(eq(callRecordingSessions.id, session.id));
      logger.warn({ sessionId: session.id }, "Recording reconciliation will retry");
    }
  }
}

export async function listPrivateCallTranscripts(consultationId: string) {
  const rows = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.consultationId, consultationId))
    .orderBy(callRecordingSessions.createdAt);
  return rows.map((row) => ({
    id: row.id,
    consultationId: row.consultationId,
    status: row.status,
    generatedTranscript: row.generatedTranscript,
    editedTranscript: row.editedTranscript,
    detectedLanguages: row.detectedLanguages,
    createdAt: row.createdAt,
    completedAt: row.roomEndedAt,
  }));
}

let workerRunning = false;
export async function callRecordingTick() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    await reconcileCallRecordingSessions();
    await processCallRecordingQueue(1);
  } catch {
    logger.error("Call recording worker failed; saved work will be retried");
  } finally {
    workerRunning = false;
  }
}

export function startCallRecordingWorker() {
  void callRecordingTick();
  const timer = setInterval(() => { void callRecordingTick(); }, 15_000);
  timer.unref();
  return () => clearInterval(timer);
}
