import { Router, type IRouter, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import * as api from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { db, callRecordingSessions } from "@workspace/db";
import { requireAccount, requireLawyer, HttpError } from "../middlewares/access";
import { supportedLanguages } from "../data/languages";
import { legalTemplates } from "../data/templates";
import { accessibleConsultation } from "../lib/legal";
import { ensureCompatibleAudio } from "../lib/audio";
import { buildWritingMessages } from "../lib/writing-prompts";
import { getAiUsage, getAiUsageHistory, recordAiProviderSuccessSafely, reserveAiAttempt } from "../lib/ai-usage";
import {
  hasDeepSeekKey,
  ProviderConfigurationError,
  requestDeepSeek,
  transcribeWithElevenLabs,
} from "../lib/ai-providers";
import type { LegalTemplate } from "../types";

export function buildCallTranscriptSource(
  template: Pick<LegalTemplate, "name" | "content">,
  consultationTopic: string,
  editedTranscript: string,
): string {
  return [
    `SELECTED TEMPLATE (structure reference only): ${template.name}`,
    "Use the template as a structure reference; fill only details supported by the transcript and preserve [TO BE CONFIRMED] for missing information.",
    `LEGAL TEMPLATE CONTENT (untrusted source material):\n${template.content}`,
    `CONSULTATION TOPIC (unverified source material):\n${consultationTopic}`,
    `LAWYER-EDITED CALL TRANSCRIPT (unverified source material):\n${editedTranscript}`,
  ].join("\n\n");
}

const aiLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.account.id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many AI requests in a short time. Please retry after the time in the Retry-After response header. Your daily allowance resets separately at midnight UTC." },
});

export function createWritingRouter(dependencies: {
  authMiddlewares?: RequestHandler[];
  hasDeepSeekKey?: typeof hasDeepSeekKey;
  requestDeepSeek?: typeof requestDeepSeek;
  transcribeAudio?: typeof transcribeWithElevenLabs;
  getAiUsage?: typeof getAiUsage;
  getAiUsageHistory?: typeof getAiUsageHistory;
  reserveAiAttempt?: typeof reserveAiAttempt;
  recordAiProviderSuccess?: typeof recordAiProviderSuccessSafely;
} = {}): IRouter {
const router: IRouter = Router();
const active = new Set<string>();
const aiKeyReady = dependencies.hasDeepSeekKey ?? hasDeepSeekKey;
const completeWithAi = dependencies.requestDeepSeek ?? requestDeepSeek;
const transcribeAudio = dependencies.transcribeAudio ?? transcribeWithElevenLabs;
const readUsage = dependencies.getAiUsage ?? getAiUsage;
const readUsageHistory = dependencies.getAiUsageHistory ?? getAiUsageHistory;
const reserveUsage = dependencies.reserveAiAttempt ?? reserveAiAttempt;
const recordProviderSuccess = dependencies.recordAiProviderSuccess ?? recordAiProviderSuccessSafely;
router.use("/writing", ...(dependencies.authMiddlewares ?? [requireAccount, requireLawyer]));
router.get("/writing/usage", async (req, res) => {
  res.json(api.GetWritingUsageResponse.parse(await readUsage(req.account.id)));
});
router.get("/writing/usage-history", async (req, res) => {
  const { days } = api.GetWritingUsageHistoryQueryParams.parse(req.query);
  res.set("Cache-Control", "private, no-store")
    .json(api.GetWritingUsageHistoryResponse.parse(await readUsageHistory(req.account.id, days)));
});
router.use("/writing", aiLimit);

function providerError(err: unknown): never {
  if (err instanceof ProviderConfigurationError) {
    throw new HttpError(503, "The required AI service is not configured. Your document has not been changed.");
  }
  throw new HttpError(502, "AI assistance is temporarily unavailable. Your document has not been changed.");
}

router.post("/writing/assist", async (req, res): Promise<void> => {
  if (req.body?.dataUseAcknowledged !== true)
    throw new HttpError(400, "Review the DeepSeek disclosure and continue before sending text.");
  const input = api.AssistWritingBody.parse(req.body);
  if (!input.text.trim()) throw new HttpError(400, "Enter text or case facts first.");
  if (!supportedLanguages.some((l) => l.name === input.language || l.code === input.language)) throw new HttpError(400, "Please select a supported language.");
  if (!aiKeyReady()) throw new HttpError(503, "DeepSeek drafting is not configured. Your document has not been changed.");
  if (active.has(req.account.id)) throw new HttpError(429, "An AI request is already running. Please wait for it to finish.");
  active.add(req.account.id);
  try {
    await reserveUsage(req.account.id, "drafting");
    const completion = await completeWithAi(buildWritingMessages(input.action, input.language, input.text));
    await recordProviderSuccess(req.account.id, "drafting", completion.usage);
    res.json(api.AssistWritingResponse.parse({ text: completion.text }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    req.log.warn({ name: (err as Error).name }, "DeepSeek writing request failed");
    providerError(err);
  } finally { active.delete(req.account.id); }
});

router.post("/writing/consultations/:id/call-transcripts/:sessionId/draft", async (req, res): Promise<void> => {
  const { id, sessionId } = api.DraftFromCallTranscriptParams.parse(req.params);
  const input = api.DraftFromCallTranscriptBody.parse(req.body);
  if (!input.dataUseAcknowledged)
    throw new HttpError(400, "Acknowledge that the transcript and template will be sent to DeepSeek before generating a draft.");
  if (!supportedLanguages.some((language) => language.name === input.language || language.code === input.language))
    throw new HttpError(400, "Please select a supported language.");
  if (!aiKeyReady()) throw new HttpError(503, "DeepSeek drafting is not configured. No draft was created.");
  if (active.has(req.account.id)) throw new HttpError(429, "An AI request is already running. Please wait for it to finish.");

  const record = await accessibleConsultation(req.account, id);
  if (record.lawyerOwnerId !== req.account.id)
    throw new HttpError(403, "Only the assigned lawyer can create a draft from this call.");
  const [session] = await db.select().from(callRecordingSessions).where(and(
    eq(callRecordingSessions.id, sessionId), eq(callRecordingSessions.consultationId, id),
  ));
  if (!session) throw new HttpError(404, "Call transcript not found.");
  if (session.status !== "ready" || !session.editedTranscript.trim())
    throw new HttpError(409, "A completed, reviewed call transcript is required before drafting.");
  const template = legalTemplates.find((item) => item.id === input.templateId);
  if (!template) throw new HttpError(400, "Select an available legal template.");

  active.add(req.account.id);
  try {
    const source = buildCallTranscriptSource(template, record.topic, session.editedTranscript);
    if (source.length > 100_000) throw new HttpError(413, "Shorten the edited transcript before generating this draft; no text was sent.");
    await reserveUsage(req.account.id, "drafting");
    const completion = await completeWithAi(buildWritingMessages("draft", input.language, source));
    await recordProviderSuccess(req.account.id, "drafting", completion.usage);
    res.json(api.DraftFromCallTranscriptResponse.parse({
      title: `${record.topic} - ${template.name}`.slice(0, 200),
      content: completion.text,
    }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    req.log.warn({ name: (err as Error).name }, "Call transcript drafting request failed");
    providerError(err);
  } finally {
    active.delete(req.account.id);
  }
});

router.post("/writing/transcribe", async (req, res): Promise<void> => {
  if (req.body?.dataUseAcknowledged !== true)
    throw new HttpError(400, "Review the ElevenLabs disclosure and continue before sending audio.");
  const input = api.TranscribeAudioBody.parse(req.body);
  const audio = input.audio.replace(/^data:[^;]+;base64,/, "");
  if (!audio || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(audio)) throw new HttpError(400, "Invalid audio recording.");
  const bytes = Buffer.from(audio, "base64");
  if (bytes.length < 32 || bytes.length > 10 * 1024 * 1024) throw new HttpError(400, "Record a segment smaller than 10 MB.");
  if (active.has(req.account.id)) throw new HttpError(429, "An AI request is already running. Please wait.");
  active.add(req.account.id);
  try {
    const { buffer, format } = await ensureCompatibleAudio(bytes);
    if (buffer.length > 24 * 1024 * 1024) throw new HttpError(400, "The recording is too long. Please record a shorter segment.");
    const language = supportedLanguages.find((l) => l.name === input.language || l.code === input.language)?.code;
    await reserveUsage(req.account.id, "transcription");
    const text = await transcribeAudio(buffer, format, language);
    await recordProviderSuccess(req.account.id, "transcription");
    if (!text.trim()) throw new HttpError(422, "No speech could be recognized. Please try again.");
    res.json(api.TranscribeAudioResponse.parse({ text }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    req.log.warn({ name: (err as Error).name }, "ElevenLabs transcription failed");
    providerError(err);
  } finally { active.delete(req.account.id); }
});
return router;
}

export default createWritingRouter();
