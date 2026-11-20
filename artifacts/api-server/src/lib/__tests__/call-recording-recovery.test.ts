import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import express, { type RequestHandler } from "express";
import pinoHttp from "pino-http";
import pino from "pino";
import twilio from "twilio";
import nock from "nock";
import { eq, inArray } from "drizzle-orm";
import {
  accounts,
  aiUsage,
  callRecordingConsents,
  callRecordingSessions,
  callRecordingTracks,
  consultations,
  db,
  deliverables,
  lawyers,
  notifications,
  pool,
} from "@workspace/db";
import { createConsultationsRouter } from "../../routes/consultations";
import { apiErrorHandler, type Account } from "../../middlewares/access";
import { processCallRecordingQueue, twilioVideoRecordingWebhook } from "../call-recordings";
import { saveCallRecordingConsent } from "../consultation-calls";

assert.equal(process.env.NODE_ENV, "test");
const prefix = `recording-recovery-${randomUUID()}`;
const clientId = `${prefix}-client`;
const lawyerOwnerId = `${prefix}-lawyer`;
const otherClientId = `${prefix}-other-client`;
const otherLawyerId = `${prefix}-other-lawyer`;
const lawyerProfileId = `${prefix}-profile`;
const consultationIds: string[] = [];
const fixtureAccountIds = [clientId, lawyerOwnerId, otherClientId, otherLawyerId];
const fixtureAccounts = new Map<string, Account>();
const twilioSid = `AC${"4".repeat(32)}`;
const twilioToken = "synthetic-recording-test-token";
let server: Server | undefined;
let baseUrl = "";

function testSid(kind: "RM" | "RT" | "PA" | "MT") {
  return `${kind}${randomUUID().replaceAll("-", "")}`;
}

async function createConsultation(overrides: Partial<typeof consultations.$inferInsert> = {}) {
  const id = randomUUID();
  consultationIds.push(id);
  const startsAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const [row] = await db.insert(consultations).values({
    id,
    userId: clientId,
    lawyerId: lawyerProfileId,
    topic: "Synthetic recording recovery case",
    mode: "call",
    package: "consultation_only",
    status: "booked",
    paymentStatus: "paid",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
    fee: 100,
    callRecordingMode: "recorded",
    ...overrides,
  }).returning();
  return row;
}

async function grantMutualConsent(consultationId: string) {
  await db.insert(callRecordingConsents).values([
    { id: randomUUID(), consultationId, userId: clientId, consent: true },
    { id: randomUUID(), consultationId, userId: lawyerOwnerId, consent: true },
  ]);
}

async function insertSession(
  consultationId: string,
  roomSid: string,
  options: { roomEnded?: boolean; inventoryComplete?: boolean; status?: "recording" | "processing" | "ready" | "failed" | "withdrawn" } = {},
) {
  return db.insert(callRecordingSessions).values({
    id: randomUUID(),
    consultationId,
    roomSid,
    status: options.status ?? "recording",
    roomEndedAt: options.roomEnded ? new Date().toISOString() : null,
    inventoryComplete: options.inventoryComplete ?? false,
  }).returning();
}

function completedRecording(roomSid: string, participantSid: string, recordingSid: string) {
  return {
    sid: recordingSid,
    status: "completed",
    type: "audio",
    container_format: "mka",
    grouping_sids: { room_sid: roomSid, participant_sid: participantSid },
    source_sid: `MT${"8".repeat(32)}`,
    offset: 1000,
    duration: 2,
  };
}

function testWav() {
  const wav = Buffer.alloc(46);
  wav.write("RIFF", 0); wav.writeUInt32LE(38, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(2, 40);
  return wav;
}

function mockRecordingMedia(recordingSid: string) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), `https://video.twilio.com/v1/Recordings/${recordingSid}/Media`);
    const response = new Response(testWav());
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  };
  return () => { globalThis.fetch = originalFetch; };
}

async function sendTwilioCallback(body: Record<string, string>) {
  const url = `${process.env.APP_PUBLIC_URL}/api/communications/twilio-video-recordings`;
  const signature = twilio.getExpectedTwilioSignature(twilioToken, url, body);
  const req = {
    originalUrl: "/api/communications/twilio-video-recordings",
    body,
    header: (name: string) => name.toLowerCase() === "x-twilio-signature" ? signature : undefined,
  } as never;
  let statusCode = 200;
  const res = {
    status(code: number) { statusCode = code; return this; },
    end() { return this; },
  } as never;
  await twilioVideoRecordingWebhook(req, res);
  return statusCode;
}

async function requestAs(accountId: string, path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-account-id": accountId,
      ...init.headers,
    },
  });
}

before(async () => {
  process.env.TWILIO_ACCOUNT_SID = twilioSid;
  process.env.TWILIO_AUTH_TOKEN = twilioToken;
  process.env.TWILIO_CALL_RECORDING_ENABLED = "false";
  process.env.TWILIO_CALLS_ENABLED = "false";
  process.env.APP_PUBLIC_URL = "https://example.test";
  process.env.AI_TRANSCRIPTION_DAILY_LIMIT = "100";
  nock.disableNetConnect();
  nock.enableNetConnect("127.0.0.1");

  for (const id of fixtureAccountIds) {
    const [account] = await db.insert(accounts).values({
      id,
      name: "Synthetic recording fixture",
      email: `${id}@example.test`,
      role: id === lawyerOwnerId || id === otherLawyerId ? "lawyer" : "client",
    }).returning();
    fixtureAccounts.set(id, account);
  }
  await db.insert(lawyers).values({
    id: lawyerProfileId,
    ownerId: lawyerOwnerId,
    name: "Synthetic advocate",
    title: "Advocate",
    bio: "Synthetic test profile.",
    practiceAreas: ["Civil Law"],
    languages: ["English"],
    experienceYears: 1,
    barCouncil: "Synthetic Council",
    enrollmentNumber: prefix,
    fee: 100,
    city: "Synthetic City",
    availability: [0, 1, 2, 3, 4, 5, 6],
    approvalStatus: "approved",
  });

  const auth: RequestHandler = (req, res, next) => {
    const account = fixtureAccounts.get(req.get("x-test-account-id") ?? "");
    if (!account) { res.status(401).json({ error: "Synthetic account required." }); return; }
    req.account = account;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use(createConsultationsRouter({ authMiddlewares: [auth] }));
  app.use(apiErrorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve);
    server!.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    server.close();
    await new Promise<void>((resolve) => server!.once("close", resolve));
  }
  nock.cleanAll();
  nock.enableNetConnect();
  if (consultationIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, fixtureAccountIds));
    await db.delete(deliverables).where(inArray(deliverables.consultationId, consultationIds));
    await db.delete(consultations).where(inArray(consultations.id, consultationIds));
  }
  await db.delete(aiUsage).where(eq(aiUsage.accountId, lawyerOwnerId));
  await db.delete(lawyers).where(eq(lawyers.id, lawyerProfileId));
  await db.delete(accounts).where(inArray(accounts.id, fixtureAccountIds));
  await pool.end();
});

test("delayed room-end and duplicate recording callbacks preserve one queued track", async () => {
  const consultation = await createConsultation();
  await grantMutualConsent(consultation.id);
  const roomSid = testSid("RM");
  const recordingSid = testSid("RT");
  await insertSession(consultation.id, roomSid);

  const roomEnd = {
    AccountSid: twilioSid,
    RoomSid: roomSid,
    StatusCallbackEvent: "room-ended",
  };
  assert.equal(await sendTwilioCallback(roomEnd), 204);
  const [ended] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.roomSid, roomSid));
  assert.ok(ended.roomEndedAt);

  const completed = {
    AccountSid: twilioSid,
    RoomSid: roomSid,
    RecordingSid: recordingSid,
    ParticipantIdentity: clientId,
    SourceSid: testSid("MT"),
    TrackKind: "audio",
    Container: "mka",
    StatusCallbackEvent: "recording-completed",
  };
  assert.equal(await sendTwilioCallback(completed), 204);
  assert.equal(await sendTwilioCallback(completed), 204);
  assert.equal(await sendTwilioCallback(roomEnd), 204);

  const tracks = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.recordingSid, recordingSid));
  assert.equal(tracks.length, 1, "duplicate callbacks must not create a duplicate track");
  assert.equal(tracks[0].status, "queued");
  const [afterDuplicate] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, ended.id));
  assert.equal(afterDuplicate.roomEndedAt, ended.roomEndedAt, "a delayed duplicate room-end must retain its original timestamp");
  await db.update(callRecordingTracks).set({ status: "failed" }).where(eq(callRecordingTracks.id, tracks[0].id));
});

test("participant lookup failure returns a retryable error and the callback succeeds on retry", async () => {
  const consultation = await createConsultation();
  await grantMutualConsent(consultation.id);
  const roomSid = testSid("RM");
  const recordingSid = testSid("RT");
  const participantSid = testSid("PA");
  await insertSession(consultation.id, roomSid);
  const callback = {
    AccountSid: twilioSid,
    RoomSid: roomSid,
    RecordingSid: recordingSid,
    ParticipantSid: participantSid,
    SourceSid: testSid("MT"),
    TrackKind: "audio",
    Container: "mka",
    StatusCallbackEvent: "recording-completed",
  };

  const failedLookup = nock("https://video.twilio.com")
    .get(`/v1/Rooms/${roomSid}/Participants/${participantSid}`)
    .reply(503, { message: "synthetic temporary outage" });
  assert.equal(await sendTwilioCallback(callback), 500);
  assert.ok(failedLookup.isDone());
  assert.equal((await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.recordingSid, recordingSid))).length, 0);

  const retriedLookup = nock("https://video.twilio.com")
    .get(`/v1/Rooms/${roomSid}/Participants/${participantSid}`)
    .reply(200, { sid: participantSid, identity: clientId });
  assert.equal(await sendTwilioCallback(callback), 204);
  assert.ok(retriedLookup.isDone());
  const tracks = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.recordingSid, recordingSid));
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].participantId, clientId);
  await db.update(callRecordingTracks).set({ status: "failed" }).where(eq(callRecordingTracks.id, tracks[0].id));
});

test("late recording callbacks after withdrawal create deletion-only work and stay deduplicated", async () => {
  const consultation = await createConsultation();
  await grantMutualConsent(consultation.id);
  const roomSid = testSid("RM");
  const recordingSid = testSid("RT");
  const [session] = await insertSession(consultation.id, roomSid, {
    roomEnded: true,
    inventoryComplete: true,
    status: "processing",
  });
  const withdrawal = await saveCallRecordingConsent(fixtureAccounts.get(clientId)!, consultation.id, false);
  assert.equal(withdrawal.mode, "unrecorded");

  const callback = {
    AccountSid: twilioSid,
    RoomSid: roomSid,
    RecordingSid: recordingSid,
    ParticipantIdentity: clientId,
    SourceSid: testSid("MT"),
    TrackKind: "audio",
    Container: "mka",
    StatusCallbackEvent: "recording-completed",
  };
  assert.equal(await sendTwilioCallback(callback), 204);
  assert.equal(await sendTwilioCallback(callback), 204);
  const beforeDeletion = await db.select().from(callRecordingTracks)
    .where(eq(callRecordingTracks.recordingSid, recordingSid));
  assert.equal(beforeDeletion.length, 1, "duplicate late callbacks must not create extra tracks");
  assert.equal(beforeDeletion[0]?.status, "failed_delete_pending");
  assert.equal(beforeDeletion[0]?.lastError, "consent_withdrawn");
  assert.deepEqual(beforeDeletion[0]?.transcriptWords, []);
  assert.equal(beforeDeletion[0]?.transcribedAt, null);

  const removeAudio = nock("https://video.twilio.com").delete(`/v1/Recordings/${recordingSid}`).reply(204);
  let transcriptionCalls = 0;
  const options = {
    transcribe: async () => {
      transcriptionCalls++;
      return { text: "This must never be transcribed.", languageCode: "en", words: [] };
    },
  };
  await processCallRecordingQueue(1, options);
  assert.ok(removeAudio.isDone());
  assert.equal(transcriptionCalls, 0, "withdrawn audio is deleted without transcription");

  assert.equal(await sendTwilioCallback(callback), 204);
  await processCallRecordingQueue(1, options);
  const afterDuplicate = await db.select().from(callRecordingTracks)
    .where(eq(callRecordingTracks.recordingSid, recordingSid));
  assert.equal(afterDuplicate.length, 1);
  assert.equal(afterDuplicate[0]?.status, "failed");
  assert.ok(afterDuplicate[0]?.deletedAt);
  assert.deepEqual(afterDuplicate[0]?.transcriptWords, []);
  assert.equal(afterDuplicate[0]?.transcribedAt, null);
  assert.equal(transcriptionCalls, 0, "a callback after deletion cannot requeue transcription");
  const [persistedSession] = await db.select().from(callRecordingSessions)
    .where(eq(callRecordingSessions.id, session.id));
  assert.equal(persistedSession?.status, "withdrawn");
  assert.equal(persistedSession?.generatedTranscript, "");
  const [persistedConsultation] = await db.select().from(consultations)
    .where(eq(consultations.id, consultation.id));
  assert.equal(persistedConsultation?.callRecordingMode, "unrecorded");
});

test("withdrawn audio stays private when Twilio deletion fails and a later worker retries", async () => {
  const consultation = await createConsultation();
  await grantMutualConsent(consultation.id);
  const roomSid = testSid("RM");
  const recordingSid = testSid("RT");
  const [session] = await insertSession(consultation.id, roomSid, {
    roomEnded: true,
    inventoryComplete: true,
  });
  const [track] = await db.insert(callRecordingTracks).values({
    id: randomUUID(),
    sessionId: session.id,
    recordingSid,
    participantId: clientId,
    speaker: "client",
    status: "queued",
  }).returning();

  const withdrawal = await saveCallRecordingConsent(fixtureAccounts.get(clientId)!, consultation.id, false);
  assert.equal(withdrawal.mode, "unrecorded");
  let transcriptionCalls = 0;
  const options = {
    transcribe: async () => {
      transcriptionCalls++;
      return { text: "This must never be transcribed.", languageCode: "en", words: [] };
    },
  };

  await processCallRecordingQueue(1, options);
  let [pending] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.id, track.id));
  let [withdrawn] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, session.id));
  assert.equal(pending?.status, "failed_delete_pending");
  assert.equal(pending?.lastError, "consent_withdrawn");
  assert.equal(pending?.transcribedAt, null);
  assert.deepEqual(pending?.transcriptWords, []);
  assert.equal(withdrawn?.status, "withdrawn");
  assert.equal(withdrawn?.generatedTranscript, "");
  assert.equal(withdrawn?.editedTranscript, "");
  assert.equal(transcriptionCalls, 0);

  const failedDelete = nock("https://video.twilio.com")
    .delete(`/v1/Recordings/${recordingSid}`)
    .reply(503, { message: "synthetic temporary deletion outage" });
  await processCallRecordingQueue(1, options);
  assert.ok(failedDelete.isDone());
  [pending] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.id, track.id));
  [withdrawn] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, session.id));
  assert.equal(pending?.status, "failed_delete_pending", "failed removal remains durable retry work");
  assert.equal(pending?.lastError, "consent_withdrawn", "the withdrawal reason survives provider outages");
  assert.equal(pending?.transcribedAt, null);
  assert.deepEqual(pending?.transcriptWords, []);
  assert.equal(withdrawn?.status, "withdrawn");
  assert.equal(withdrawn?.generatedTranscript, "");
  assert.equal(withdrawn?.editedTranscript, "");
  assert.equal(transcriptionCalls, 0);

  const successfulDelete = nock("https://video.twilio.com")
    .delete(`/v1/Recordings/${recordingSid}`)
    .reply(204);
  await processCallRecordingQueue(1, options);
  assert.ok(successfulDelete.isDone());
  [pending] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.id, track.id));
  [withdrawn] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, session.id));
  assert.equal(pending?.status, "failed");
  assert.ok(pending?.deletedAt);
  assert.equal(pending?.transcribedAt, null);
  assert.deepEqual(pending?.transcriptWords, []);
  assert.equal(withdrawn?.status, "withdrawn");
  assert.equal(withdrawn?.generatedTranscript, "");
  assert.equal(withdrawn?.editedTranscript, "");
  assert.equal(transcriptionCalls, 0, "recovery deletes audio without calling transcription");
});

test("consent withdrawn during transcription prevents transcript save and retries raw-audio deletion", async () => {
  const consultation = await createConsultation();
  await grantMutualConsent(consultation.id);
  const roomSid = testSid("RM");
  const recordingSid = testSid("RT");
  const [session] = await insertSession(consultation.id, roomSid, { roomEnded: true, inventoryComplete: true });
  const [track] = await db.insert(callRecordingTracks).values({
    id: randomUUID(),
    sessionId: session.id,
    recordingSid,
    participantId: clientId,
    speaker: "client",
  }).returning();
  const recording = completedRecording(roomSid, testSid("PA"), recordingSid);
  const recordingFetch = nock("https://video.twilio.com")
    .get(`/v1/Recordings/${recordingSid}`)
    .reply(200, recording);
  const restoreFetch = mockRecordingMedia(recordingSid);
  let markTranscriptionStarted!: () => void;
  const transcriptionStarted = new Promise<void>((resolve) => { markTranscriptionStarted = resolve; });
  let finishTranscription!: (value: { text: string; languageCode: string; words: { text: string; startSeconds: number; endSeconds: number; languageCode: string }[] }) => void;
  const transcriptionResult = new Promise<{ text: string; languageCode: string; words: { text: string; startSeconds: number; endSeconds: number; languageCode: string }[] }>((resolve) => { finishTranscription = resolve; });
  try {
    const worker = processCallRecordingQueue(1, {
      transcribe: async () => {
        markTranscriptionStarted();
        return transcriptionResult;
      },
    });
    await transcriptionStarted;
    const withdrawal = await saveCallRecordingConsent(fixtureAccounts.get(clientId)!, consultation.id, false);
    assert.equal(withdrawal.mode, "unrecorded");
    finishTranscription({
      text: "This transcript must not be saved.",
      languageCode: "en",
      words: [{ text: "private", startSeconds: 0, endSeconds: 0.4, languageCode: "en" }],
    });
    await worker;
  } finally {
    restoreFetch();
  }
  assert.ok(recordingFetch.isDone());
  const [withheld] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.id, track.id));
  assert.equal(withheld.status, "failed_delete_pending");
  assert.equal(withheld.lastError, "consent_withdrawn");
  assert.equal(withheld.transcriptWords.length, 0);

  const deleteRawAudio = nock("https://video.twilio.com").delete(`/v1/Recordings/${recordingSid}`).reply(204);
  await processCallRecordingQueue(1);
  assert.ok(deleteRawAudio.isDone());
  const [deleted] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.id, track.id));
  assert.equal(deleted.status, "failed");
  assert.ok(deleted.deletedAt);
  const [withdrawn] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, session.id));
  assert.equal(withdrawn.status, "withdrawn");
  assert.equal(withdrawn.generatedTranscript, "");
});

test("a restarted worker deletes saved audio without retranscribing", async () => {
  const consultation = await createConsultation();
  await grantMutualConsent(consultation.id);
  const roomSid = testSid("RM");
  const recordingSid = testSid("RT");
  const [session] = await insertSession(consultation.id, roomSid, { roomEnded: true, inventoryComplete: true });
  const [track] = await db.insert(callRecordingTracks).values({
    id: randomUUID(),
    sessionId: session.id,
    recordingSid,
    participantId: clientId,
    speaker: "client",
  }).returning();
  const recording = completedRecording(roomSid, testSid("PA"), recordingSid);
  const fetchRecording = nock("https://video.twilio.com")
    .get(`/v1/Recordings/${recordingSid}`)
    .reply(200, recording);
  const failedDelete = nock("https://video.twilio.com")
    .delete(`/v1/Recordings/${recordingSid}`)
    .reply(503, { message: "synthetic delete outage" });
  const restoreFetch = mockRecordingMedia(recordingSid);
  let transcriptionCalls = 0;
  const transcribe = async () => {
    transcriptionCalls += 1;
    return {
      text: "Saved before raw-audio deletion.",
      languageCode: "en",
      words: [{ text: "saved", startSeconds: 0, endSeconds: 0.4, languageCode: "en" }],
    };
  };
  try {
    await processCallRecordingQueue(1, { transcribe });
  } finally {
    restoreFetch();
  }
  assert.ok(fetchRecording.isDone());
  assert.ok(failedDelete.isDone());
  const [pendingDelete] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.id, track.id));
  assert.equal(pendingDelete.status, "transcribed_delete_pending");
  assert.ok(pendingDelete.transcribedAt);
  assert.equal(transcriptionCalls, 1);

  const successfulDelete = nock("https://video.twilio.com").delete(`/v1/Recordings/${recordingSid}`).reply(204);
  await processCallRecordingQueue(1, { transcribe });
  assert.ok(successfulDelete.isDone());
  assert.equal(transcriptionCalls, 1, "recovery must resume at deletion, not call transcription again");
  const [completed] = await db.select().from(callRecordingTracks).where(eq(callRecordingTracks.id, track.id));
  assert.equal(completed.status, "transcribed");
  assert.ok(completed.deletedAt);
  const [ready] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, session.id));
  assert.equal(ready.status, "ready");
  assert.match(ready.generatedTranscript, /Client \(English\): saved/);
  assert.equal(ready.editedTranscript, ready.generatedTranscript);
});

test("transcripts stay assigned-lawyer-only, edits persist, and delivery needs review confirmation", async () => {
  const consultation = await createConsultation();
  const [session] = await insertSession(consultation.id, testSid("RM"), {
    roomEnded: true,
    inventoryComplete: true,
    status: "ready",
  });
  await db.update(callRecordingSessions).set({
    generatedTranscript: "Original generated transcript.",
    editedTranscript: "Original generated transcript.",
  }).where(eq(callRecordingSessions.id, session.id));

  const assignedLawyer = await requestAs(lawyerOwnerId, `/consultations/${consultation.id}/call-transcripts`);
  assert.equal(assignedLawyer.status, 200);
  const listed = await assignedLawyer.json() as Array<{ id: string; editedTranscript: string }>;
  assert.equal(listed[0]?.id, session.id);

  for (const accountId of [clientId, otherLawyerId, otherClientId]) {
    const denied = await requestAs(accountId, `/consultations/${consultation.id}/call-transcripts`);
    assert.ok([403, 404].includes(denied.status), `${accountId} must not access the transcript`);
  }

  const edit = await requestAs(lawyerOwnerId, `/consultations/${consultation.id}/call-transcripts/${session.id}`, {
    method: "PATCH",
    body: JSON.stringify({ editedTranscript: "Lawyer-reviewed correction." }),
  });
  assert.equal(edit.status, 200);
  const edited = await edit.json() as { editedTranscript: string };
  assert.equal(edited.editedTranscript, "Lawyer-reviewed correction.");
  const [persisted] = await db.select().from(callRecordingSessions).where(eq(callRecordingSessions.id, session.id));
  assert.equal(persisted.editedTranscript, "Lawyer-reviewed correction.");

  const createWithoutReview = await requestAs(lawyerOwnerId, `/consultations/${consultation.id}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      title: "Synthetic draft",
      content: "Document text.",
      status: "delivered",
      reviewConfirmed: false,
    }),
  });
  assert.equal(createWithoutReview.status, 409);
  assert.equal((await db.select().from(deliverables).where(eq(deliverables.consultationId, consultation.id))).length, 0);

  const [draft] = await db.insert(deliverables).values({
    id: randomUUID(),
    consultationId: consultation.id,
    title: "Synthetic draft",
    content: "Document text.",
    status: "draft",
  }).returning();
  const updateWithoutReview = await requestAs(lawyerOwnerId, `/deliverables/${draft.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: draft.title,
      content: draft.content,
      status: "delivered",
      reviewConfirmed: false,
    }),
  });
  assert.equal(updateWithoutReview.status, 409);
  const [stillDraft] = await db.select().from(deliverables).where(eq(deliverables.id, draft.id));
  assert.equal(stillDraft.status, "draft");
  assert.equal(stillDraft.lawyerReviewedAt, null);
});
