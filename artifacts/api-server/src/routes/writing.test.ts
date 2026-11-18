import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";
import { ProviderRequestError } from "../lib/ai-providers";
import pinoHttp from "pino-http";
import pino from "pino";

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
      return { text: "Draft for advocate review.", usage: null };
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
    });
    const first = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(first.status, 502);
    const firstBody = await first.json() as { error?: unknown };
    assert.match(String(firstBody.error), /temporarily unavailable/i);

    const second = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { text: "Draft for advocate review." });
    assert.equal(providerCalls, 2, "the second request must reach the provider mock");
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
      return { text: "Draft for advocate review.", usage: null };
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

    releaseFirstProviderCall({ text: "First draft for advocate review.", usage: null });
    const firstResponse = await firstRequest;
    assert.equal(firstResponse.status, 200);
    assert.deepEqual(await firstResponse.json(), { text: "First draft for advocate review." });

    const retryResponse = await request();
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { text: "Draft for advocate review." });
    assert.equal(providerCalls, 2, "a later request must reach the provider after the first finishes");
    assert.equal(reservationCalls, 2, "only the successful later retry reserves another AI attempt");
  } finally {
    server.close();
    await new Promise<void>((resolve) => server.once("close", resolve));
  }
});
