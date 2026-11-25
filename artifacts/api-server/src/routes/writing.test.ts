import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";
import { ProviderRequestError } from "../lib/ai-providers";
import { ADVOCATE_REVIEW_NOTE } from "../lib/writing-prompts";
import { validateWritingOutput } from "../lib/writing-output-validation";
import pinoHttp from "pino-http";
import pino from "pino";

async function assertDisclosureRequired(url: string, acknowledgedBody: string, provider: string) {
  const fields = JSON.parse(acknowledgedBody);
  for (const value of [undefined, false, "true", 1, null]) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...fields, dataUseAcknowledged: value }),
    });
    assert.equal(response.status, 400);
    const result = await response.json() as { error: string };
    assert.match(result.error, new RegExp(`${provider} disclosure`));
  }
}

test("a failed drafting request releases the lawyer lock for a later request", async () => {
  // The route's imports initialize a lazy DB pool, but this test never queries it.
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/writing_route_test";
  const [{ createWritingRouter }, { apiErrorHandler }] = await Promise.all([
    import("./writing"),
    import("../middlewares/access"),
  ]);
  let providerCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    req.account = { id: "synthetic-lawyer-account", role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    hasDeepSeekKey: () => true,
    getAiUsage: async () => ({
      plan: "single",
      drafting: { limit: 15, used: 2, remaining: 13 },
      transcription: { limit: 15, used: 1, remaining: 14 },
      resetsAt: "2026-11-19T00:00:00.000Z",
    }),
    reserveAiAttempt: async () => ({ used: 1, limit: 30, resetsAt: new Date().toISOString() }),
    requestDeepSeek: async (messages) => {
      providerCalls += 1;
      assert.equal(messages[1]?.content, "Fictional facts for a route test.");
      if (providerCalls === 1) throw new ProviderRequestError();
      return { text: ADVOCATE_REVIEW_NOTE, usage: null };
    },
    recordAiProviderSuccess: async () => {},
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const usageResponse = await fetch(`http://127.0.0.1:${address.port}/writing/usage`);
    assert.equal(usageResponse.status, 200);
    assert.deepEqual(await usageResponse.json(), {
      plan: "single",
      drafting: { limit: 15, used: 2, remaining: 13 },
      transcription: { limit: 15, used: 1, remaining: 14 },
      resetsAt: "2026-11-19T00:00:00.000Z",
    });

    const url = `http://127.0.0.1:${address.port}/writing/assist`;
    const body = JSON.stringify({
      action: "draft",
      text: "Fictional facts for a route test.",
      language: "English",
      dataUseAcknowledged: true,
    });
    await assertDisclosureRequired(url, body, "DeepSeek");
    assert.equal(providerCalls, 0, "unacknowledged writing must not reach DeepSeek");
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(first.status, 502);
    const firstBody = await first.json() as { error?: unknown };
    assert.match(String(firstBody.error), /temporarily unavailable/i);

    const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { text: ADVOCATE_REVIEW_NOTE });
    assert.equal(providerCalls, 2, "the second request must reach the provider mock");
  } finally {
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});

test("writing output requires the review note and preserves protected facts for every action", async () => {
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/writing_output_validation_test";
  const [{ createWritingRouter }, { apiErrorHandler }] = await Promise.all([
    import("./writing"),
    import("../middlewares/access"),
  ]);
  const source = [
    "Client: Mira Sen",
    "Amount: INR 4,800",
    "Date: 18/04/2025",
    "Reference: [CASE_REF]",
  ].join("\n");
  const translatedSource = [
    "ग्राहक: Mira Sen",
    "रक्कम: INR ४,८००",
    "तारीख: १८/०४/२०२५",
    "संदर्भ: [CASE_REF]",
  ].join("\n");
  let providerText = "";
  let providerCalls = 0;
  let successfulProviderRecords = 0;
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    req.account = { id: "synthetic-output-validation-lawyer", role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    hasDeepSeekKey: () => true,
    reserveAiAttempt: async () => ({ used: 1, limit: 30, resetsAt: new Date().toISOString() }),
    requestDeepSeek: async () => {
      providerCalls += 1;
      return { text: providerText, usage: null };
    },
    recordAiProviderSuccess: async () => { successfulProviderRecords += 1; },
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  async function submit(action: "draft" | "translate" | "improve") {
    return fetch(`http://127.0.0.1:${address.port}/writing/assist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        text: source,
        language: action === "translate" ? "Hindi" : "English",
        dataUseAcknowledged: true,
      }),
    });
  }

  async function assertRejectedSafely(response: Response) {
    assert.equal(response.status, 502);
    const body = await response.json() as { error: string };
    assert.deepEqual(body, {
      error: "AI assistance is temporarily unavailable. Your document has not been changed.",
    });
    assert.doesNotMatch(JSON.stringify(body), /Mira Sen|4,800|CASE_REF/);
  }

  try {
    for (const action of ["draft", "translate", "improve"] as const) {
      const actionSource = action === "translate" ? translatedSource : source;
      providerText = `${ADVOCATE_REVIEW_NOTE}\n${actionSource}`;
      const valid = await submit(action);
      assert.equal(valid.status, 200, `${action} should accept the required review note and protected facts.`);
      assert.deepEqual(await valid.json(), { text: providerText });

      providerText = `A response without the required review note.\n${source}`;
      await assertRejectedSafely(await submit(action));

      const changedAmount = actionSource.replace(action === "translate" ? "४,८००" : "4,800", action === "translate" ? "४,९००" : "4,900");
      providerText = `${ADVOCATE_REVIEW_NOTE}\n${changedAmount}`;
      await assertRejectedSafely(await submit(action));
    }

    providerText = `${ADVOCATE_REVIEW_NOTE}\n${source.replace("Mira Sen", "Mira Desai")}`;
    await assertRejectedSafely(await submit("draft"));

    assert.equal(providerCalls, 10, "each response should come from the provider mock only");
    assert.equal(successfulProviderRecords, 3, "rejected responses must not be recorded as successful provider outputs");
  } finally {
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});

test("localized numbers remain protected and changed placeholders fail validation", () => {
  const source = "Amount: INR 4,800\nDate: 18/04/2025\nReference: [CASE_REF]";
  const translated = `${ADVOCATE_REVIEW_NOTE}\nरक्कम: INR ४,८००\nतारीख: १८/०४/२०२५\nसंदर्भ: [CASE_REF]`;
  const changedPlaceholder = `${ADVOCATE_REVIEW_NOTE}\nAmount: INR 4,800\nDate: 18/04/2025\nReference: [OTHER_REF]`;

  assert.deepEqual(validateWritingOutput(source, translated), { valid: true });
  assert.deepEqual(validateWritingOutput(source, changedPlaceholder), {
    valid: false,
    reason: "protected_fact_missing",
  });
});

test("a different lawyer cannot draft from another lawyer's call transcript", async () => {
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/writing_foreign_transcript_test";
  const [{ createWritingRouter }, { apiErrorHandler }] = await Promise.all([
    import("./writing"),
    import("../middlewares/access"),
  ]);
  const transcriptMarker = "PRIVATE-SYNTHETIC-TRANSCRIPT-CONTENT";
  let reservationCalls = 0;
  let providerCalls = 0;
  let logs = "";
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({
    quietReqLogger: true,
    logger: pino({ level: "trace" }, { write: (line) => { logs += line; } }),
  }));
  app.use((req, _res, next) => {
    req.account = { id: "synthetic-unassigned-lawyer", role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    hasDeepSeekKey: () => true,
    accessibleConsultation: async (account, consultationId) => {
      assert.equal(account.id, "synthetic-unassigned-lawyer");
      assert.equal(consultationId, "synthetic-consultation-id");
      return {
        lawyerOwnerId: "synthetic-assigned-lawyer",
        topic: transcriptMarker,
      } as never;
    },
    reserveAiAttempt: async () => {
      reservationCalls += 1;
      return { used: 1, limit: 30, resetsAt: new Date().toISOString() };
    },
    requestDeepSeek: async () => {
      providerCalls += 1;
      return { text: ADVOCATE_REVIEW_NOTE, usage: null };
    },
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/writing/consultations/synthetic-consultation-id/call-transcripts/synthetic-session-id/draft`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: "legal-notice",
          language: "English",
          dataUseAcknowledged: true,
        }),
      },
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Only the assigned lawyer can create a draft from this call.",
    });
    assert.equal(reservationCalls, 0, "a non-owner must not reserve AI usage");
    assert.equal(providerCalls, 0, "a non-owner must not reach the AI provider");
    assert.doesNotMatch(logs, new RegExp(transcriptMarker));
  } finally {
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});

test("a truly simultaneous drafting request for the same lawyer is rejected", async () => {
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/writing_route_test";
  const [{ createWritingRouter }, { apiErrorHandler }] = await Promise.all([
    import("./writing"),
    import("../middlewares/access"),
  ]);
  let providerCalls = 0;
  let reservationCalls = 0;
  let signalProviderStarted!: () => void;
  let releaseFirstProviderCall!: (result: { text: string; usage: null }) => void;
  const providerStarted = new Promise<void>((resolve) => { signalProviderStarted = resolve; });
  const firstProviderResult = new Promise<{ text: string; usage: null }>((resolve) => {
    releaseFirstProviderCall = resolve;
  });
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    req.account = { id: "synthetic-lock-test-lawyer", role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    hasDeepSeekKey: () => true,
    getAiUsage: async () => ({
      plan: "single",
      drafting: { limit: 15, used: 2, remaining: 13 },
      transcription: { limit: 15, used: 1, remaining: 14 },
      resetsAt: "2026-11-19T00:00:00.000Z",
    }),
    reserveAiAttempt: async () => {
      reservationCalls += 1;
      return { used: reservationCalls, limit: 30, resetsAt: new Date().toISOString() };
    },
    requestDeepSeek: async (messages) => {
      providerCalls += 1;
      assert.equal(messages[1]?.content, "Fictional facts for a concurrency test.");
      if (providerCalls === 1) {
        signalProviderStarted();
        return firstProviderResult;
      }
      return { text: ADVOCATE_REVIEW_NOTE, usage: null };
    },
    recordAiProviderSuccess: async () => {},
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const url = `http://127.0.0.1:${address.port}/writing/assist`;
    const body = JSON.stringify({
      action: "draft",
      text: "Fictional facts for a concurrency test.",
      language: "English",
      dataUseAcknowledged: true,
    });
    const request = () => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const firstRequest = request();
    await providerStarted;

    const overlappingResponse = await request();
    assert.equal(overlappingResponse.status, 429);
    assert.deepEqual(await overlappingResponse.json(), {
      error: "An AI request is already running. Please wait for it to finish.",
    });
    assert.equal(providerCalls, 1, "the overlapping request must not reach the provider");
    assert.equal(reservationCalls, 1, "the overlapping request must not reserve another AI attempt");

    releaseFirstProviderCall({ text: `${ADVOCATE_REVIEW_NOTE}\nFirst draft.`, usage: null });
    const firstResponse = await firstRequest;
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(await firstResponse.json(), { text: `${ADVOCATE_REVIEW_NOTE}\nFirst draft.` });

    const retryResponse = await request();
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { text: ADVOCATE_REVIEW_NOTE });
    assert.equal(providerCalls, 2, "a later request must reach the provider after the first finishes");
    assert.equal(reservationCalls, 2, "only the successful later retry reserves another AI attempt");
  } finally {
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});

test("separate lawyers can draft while both AI requests are pending", async () => {
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/writing_parallel_lawyers_test";
  const [{ createWritingRouter }, { apiErrorHandler }] = await Promise.all([
    import("./writing"),
    import("../middlewares/access"),
  ]);
  const lawyerA = "synthetic-concurrent-lawyer-a";
  const lawyerB = "synthetic-concurrent-lawyer-b";
  const sourceA = "Fictional drafting facts for synthetic lawyer A.";
  const sourceB = "Fictional drafting facts for synthetic lawyer B.";
  const pendingProviders = new Map<string, (result: { text: string; usage: null }) => void>();
  const reservedAccounts: string[] = [];
  let providerCalls = 0;
  let signalBothProvidersStarted!: () => void;
  const bothProvidersStarted = new Promise<void>((resolve) => {
    signalBothProvidersStarted = resolve;
  });
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    const accountId = req.get("x-test-lawyer-id");
    if (accountId !== lawyerA && accountId !== lawyerB) {
      next(new Error("Unknown synthetic lawyer."));
      return;
    }
    req.account = { id: accountId, role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    hasDeepSeekKey: () => true,
    reserveAiAttempt: async (accountId) => {
      reservedAccounts.push(accountId);
      return { used: 1, limit: 30, resetsAt: new Date().toISOString() };
    },
    requestDeepSeek: async (messages) => {
      const source = String(messages[1]?.content ?? "");
      assert.ok(source === sourceA || source === sourceB, "only synthetic facts should reach the provider mock");
      providerCalls += 1;
      return new Promise((resolve) => {
        pendingProviders.set(source, resolve);
        if (pendingProviders.size === 2) signalBothProvidersStarted();
      });
    },
    recordAiProviderSuccess: async () => {},
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const url = `http://127.0.0.1:${address.port}/writing/assist`;
  const sendDraft = (accountId: string, text: string) => fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-lawyer-id": accountId,
    },
    body: JSON.stringify({
      action: "draft",
      text,
      language: "English",
      dataUseAcknowledged: true,
    }),
  });
  let firstRequest: Promise<Response> | undefined;
  let secondRequest: Promise<Response> | undefined;
  try {
    firstRequest = sendDraft(lawyerA, sourceA);
    secondRequest = sendDraft(lawyerB, sourceB);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        bothProvidersStarted,
        ...[firstRequest, secondRequest].map((request) => request.then((response) => {
          throw new Error(`A draft request completed before both providers were pending: ${response.status}`);
        })),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Both lawyer requests did not reach the provider mock concurrently.")), 5_000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    assert.equal(providerCalls, 2, "each lawyer must reach the provider while the other call is still pending");
    assert.deepEqual(reservedAccounts.sort(), [lawyerA, lawyerB].sort());
    pendingProviders.get(sourceA)?.({ text: `${ADVOCATE_REVIEW_NOTE}\nDraft for synthetic lawyer A.`, usage: null });
    pendingProviders.get(sourceB)?.({ text: `${ADVOCATE_REVIEW_NOTE}\nDraft for synthetic lawyer B.`, usage: null });

    const [responseA, responseB] = await Promise.all([firstRequest, secondRequest]);
    assert.equal(responseA.status, 200);
    assert.equal(responseB.status, 200);
    assert.deepEqual(await responseA.json(), {
      text: `${ADVOCATE_REVIEW_NOTE}\nDraft for synthetic lawyer A.`,
    });
    assert.deepEqual(await responseB.json(), {
      text: `${ADVOCATE_REVIEW_NOTE}\nDraft for synthetic lawyer B.`,
    });
  } finally {
    pendingProviders.get(sourceA)?.({ text: ADVOCATE_REVIEW_NOTE, usage: null });
    pendingProviders.get(sourceB)?.({ text: ADVOCATE_REVIEW_NOTE, usage: null });
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});

test("a failed dictation request releases the lawyer lock for a later request", async () => {
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/writing_route_test";
  const [{ createWritingRouter }, { apiErrorHandler }] = await Promise.all([
    import("./writing"),
    import("../middlewares/access"),
  ]);
  let providerCalls = 0;
  let reservationCalls = 0;
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    req.account = { id: "synthetic-dictation-lawyer", role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    getAiUsage: async () => ({
      plan: "single",
      drafting: { limit: 15, used: 2, remaining: 13 },
      transcription: { limit: 15, used: reservationCalls, remaining: 15 - reservationCalls },
      resetsAt: "2026-11-19T00:00:00.000Z",
    }),
    reserveAiAttempt: async () => {
      reservationCalls += 1;
      return { used: reservationCalls, limit: 30, resetsAt: new Date().toISOString() };
    },
    transcribeAudio: async (audio, format, language) => {
      providerCalls += 1;
      assert.equal(audio.length, 44);
      assert.equal(format, "wav");
      assert.equal(language, "en");
      if (providerCalls === 1) throw new ProviderRequestError();
      return "Synthetic dictation transcript.";
    },
    recordAiProviderSuccess: async () => {},
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const wav = Buffer.alloc(44);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(36, 4);
    wav.write("WAVE", 8, "ascii");
    wav.write("fmt ", 12, "ascii");
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24);
    wav.writeUInt32LE(32_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36, "ascii");
    wav.writeUInt32LE(0, 40);
    const body = JSON.stringify({
      audio: wav.toString("base64"),
      mimeType: "audio/wav",
      language: "English",
      dataUseAcknowledged: true,
    });
    const url = `http://127.0.0.1:${address.port}/writing/transcribe`;
    await assertDisclosureRequired(url, body, "ElevenLabs");
    assert.equal(providerCalls, 0, "unacknowledged audio must not reach ElevenLabs");
    assert.equal(reservationCalls, 0);
    const request = () => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    const failedResponse = await request();
    assert.equal(failedResponse.status, 502);
    assert.match(String((await failedResponse.json() as { error?: unknown }).error), /temporarily unavailable/i);
    assert.equal(providerCalls, 1);
    assert.equal(reservationCalls, 1);

    const retryResponse = await request();
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { text: "Synthetic dictation transcript." });
    assert.equal(providerCalls, 2, "the retry must reach the mocked transcription provider");
    assert.equal(reservationCalls, 2);
  } finally {
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});

test("usage history uses the authenticated lawyer and returns counts only", async () => {
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/writing_route_test";
  const [{ createWritingRouter }, { apiErrorHandler }] = await Promise.all([
    import("./writing"),
    import("../middlewares/access"),
  ]);
  let requestedAccount = "";
  let requestedDays = 0;
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    req.account = { id: "synthetic-history-lawyer", role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    getAiUsageHistory: async (accountId, days) => {
      const requestedHistoryDays = days ?? 30;
      requestedAccount = accountId;
      requestedDays = requestedHistoryDays;
      return {
        days: requestedHistoryDays,
        retentionDays: 90,
        entries: [{
          day: "2026-11-24",
          plans: ["monthly"],
          planHistoryComplete: true,
          draftingRequests: 2,
          transcriptionRequests: 1,
        }],
      };
    },
  }));
  app.use(apiErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/writing/usage-history?days=7&accountId=another-account`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      days: 7,
      retentionDays: 90,
      entries: [{
        day: "2026-11-24",
        plans: ["monthly"],
        planHistoryComplete: true,
        draftingRequests: 2,
        transcriptionRequests: 1,
      }],
    });
    assert.equal(requestedAccount, "synthetic-history-lawyer");
    assert.equal(requestedDays, 7);

    const invalidRange = await fetch(`http://127.0.0.1:${address.port}/writing/usage-history?days=91`);
    assert.equal(invalidRange.status, 400);
  } finally {
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});
