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
    reserveAiAttempt: async () => ({ used: 1, limit: 30, resetsAt: new Date().toISOString() }),
    requestDeepSeek: async (messages) => {
      providerCalls += 1;
      assert.equal(messages[1]?.content, "Fictional facts for a route test.");
      if (providerCalls === 1) throw new ProviderRequestError();
      return "Draft for advocate review.";
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
