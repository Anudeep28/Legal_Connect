import { Router, type IRouter } from "express";
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
import {
  hasDeepSeekKey,
  ProviderConfigurationError,
  requestDeepSeek,
  transcribeWithElevenLabs,
} from "../lib/ai-providers";

const router: IRouter = Router();
const aiLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.account.id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "AI usage limit reached. Please try again in an hour." },
});
const active = new Set<string>();
router.use("/writing", requireAccount, requireLawyer, aiLimit);

function providerError(err: unknown): never {
  if (err instanceof ProviderConfigurationError) {
    throw new HttpError(503, "The required AI service is not configured. Your document has not been changed.");
  }
  throw new HttpError(502, "AI assistance is temporarily unavailable. Your document has not been changed.");
}

router.post("/writing/assist", async (req, res): Promise<void> => {
  const input = api.AssistWritingBody.parse(req.body);
  if (!input.text.trim()) throw new HttpError(400, "Enter text or case facts first.");
  if (!supportedLanguages.some((l) => l.name === input.language || l.code === input.language)) throw new HttpError(400, "Please select a supported language.");
  if (!hasDeepSeekKey()) throw new HttpError(503, "DeepSeek drafting is not configured. Your document has not been changed.");
  if (active.has(req.account.id)) throw new HttpError(429, "An AI request is already running. Please wait for it to finish.");
  active.add(req.account.id);
  try {
    const text = await requestDeepSeek(buildWritingMessages(input.action, input.language, input.text));
    res.json(api.AssistWritingResponse.parse({ text }));
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
  if (!hasDeepSeekKey()) throw new HttpError(503, "DeepSeek drafting is not configured. No draft was created.");
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
    const source = [
      `SELECTED TEMPLATE: ${template.name}`,
      "Use the following template as the structure and preserve relevant headings. Fill only information supported by the consultation transcript; retain [TO BE CONFIRMED] for missing details.",
      template.content,
      `CONSULTATION TOPIC (unverified source material): ${record.topic}`,
      `LAWYER-EDITED CALL TRANSCRIPT (unverified source material):\n${session.editedTranscript}`,
    ].join("\n\n");
    if (source.length > 100_000) throw new HttpError(413, "Shorten the edited transcript before generating this draft; no text was sent.");
    const text = await requestDeepSeek(buildWritingMessages("draft", input.language, source));
    res.json(api.DraftFromCallTranscriptResponse.parse({
      title: `${record.topic} - ${template.name}`.slice(0, 200),
      content: text,
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
    const text = await transcribeWithElevenLabs(buffer, format, language);
    if (!text.trim()) throw new HttpError(422, "No speech could be recognized. Please try again.");
    res.json(api.TranscribeAudioResponse.parse({ text }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    req.log.warn({ name: (err as Error).name }, "ElevenLabs transcription failed");
    providerError(err);
  } finally { active.delete(req.account.id); }
});
export default router;
