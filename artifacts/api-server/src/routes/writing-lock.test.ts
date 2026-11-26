import assert from "node:assert/strict";
import express from "express";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import pino from "pino";
import pinoHttp from "pino-http";

process.env.DATABASE_URL ??= "postgres://ai-lock-test:ai-lock-test@127.0.0.1:1/ai_lock_test";

const [
  { createWritingRouter },
  { apiErrorHandler },
  { ADVOCATE_REVIEW_NOTE },
  { ProviderRequestError },
  { tryAcquireAiWritingLock },
  { accounts, aiRequestLocks, db, pool },
  { eq, inArray },
] = await Promise.all([
  import("./writing"),
  import("../middlewares/access"),
  import("../lib/writing-prompts"),
  import("../lib/ai-providers"),
  import("../lib/ai-usage"),
  import("@workspace/db"),
  import("drizzle-orm"),
]);

type WritingRouterOptions = NonNullable<Parameters<typeof createWritingRouter>[0]>;
type ProviderResult = { text: string; usage: null };
const syntheticAccountIds: string[] = [];

async function createSyntheticLawyer() {
  const id = `ai-lock-${randomUUID()}`;
  await db.insert(accounts).values({
    id,
    name: "Synthetic AI lock lawyer",
    email: `${id}@example.test`,
    role: "lawyer",
  });
  syntheticAccountIds.push(id);
  return id;
}

function createDraftApp(
  accountId: string,
  options: Pick<WritingRouterOptions, "requestDeepSeek" | "reserveAiAttempt">,
) {
  const app = express();
  app.use(express.json());
  app.use(pinoHttp({ quietReqLogger: true, logger: pino({ level: "silent" }) }));
  app.use((req, _res, next) => {
    req.account = { id: accountId, role: "lawyer" } as never;
    next();
  });
  app.use(createWritingRouter({
    authMiddlewares: [(_req, _res, next) => next()],
    hasDeepSeekKey: () => true,
    ...options,
    recordAiProviderSuccess: async () => {},
  }));
  app.use(apiErrorHandler);
  return app;
}

async function startServer(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/writing/assist`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function sendDraft(url: string, text = "Synthetic cross-instance drafting facts.") {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "draft",
      text,
      language: "English",
      dataUseAcknowledged: true,
    }),
  });
}

async function waitForProviderStart(started: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      started,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The first API instance did not reach its mocked provider.")), 5_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test("independent API instances serialize one lawyer and release the lease after provider failure", async () => {
  const accountId = await createSyntheticLawyer();
  const source = "Synthetic cross-instance drafting facts.";
  let resolveProviderStarted!: () => void;
  const providerStarted = new Promise<void>((resolve) => { resolveProviderStarted = resolve; });
  let rejectFirstProvider!: (error: Error) => void;
  let firstProviderCalls = 0;
  let secondProviderCalls = 0;
  let firstReservations = 0;
  let secondReservations = 0;
  const firstApp = createDraftApp(accountId, {
    reserveAiAttempt: async () => {
      firstReservations += 1;
      return { used: 1, limit: 30, resetsAt: new Date().toISOString() };
    },
    requestDeepSeek: async (messages) => {
      firstProviderCalls += 1;
      assert.equal(messages[1]?.content, source);
      resolveProviderStarted();
      return new Promise<ProviderResult>((_resolve, reject) => { rejectFirstProvider = reject; });
    },
  });
  const secondApp = createDraftApp(accountId, {
    reserveAiAttempt: async () => {
      secondReservations += 1;
      return { used: secondReservations, limit: 30, resetsAt: new Date().toISOString() };
    },
    requestDeepSeek: async (messages) => {
      secondProviderCalls += 1;
      assert.equal(messages[1]?.content, source);
      return { text: `${ADVOCATE_REVIEW_NOTE}\nRecovered draft.`, usage: null };
    },
  });
  const firstServer = await startServer(firstApp);
  const secondServer = await startServer(secondApp);
  let firstRequest: Promise<Response> | undefined;
  try {
    firstRequest = sendDraft(firstServer.url, source);
    await waitForProviderStart(providerStarted);

    const blocked = await sendDraft(secondServer.url, source);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), {
      error: "An AI request is already running. Please wait for it to finish.",
    });
    assert.equal(firstProviderCalls, 1);
    assert.equal(secondProviderCalls, 0, "the second API instance must not reach its provider");
    assert.equal(firstReservations, 1);
    assert.equal(secondReservations, 0, "a blocked request must not reserve AI usage");

    rejectFirstProvider(new ProviderRequestError());
    const failed = await firstRequest;
    assert.equal(failed.status, 502);

    const retry = await sendDraft(secondServer.url, source);
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), {
      text: `${ADVOCATE_REVIEW_NOTE}\nRecovered draft.`,
    });
    assert.equal(secondProviderCalls, 1, "the other instance can retry after the provider failure releases the lease");
    assert.equal(secondReservations, 1);
  } finally {
    rejectFirstProvider?.(new Error("Test cleanup"));
    if (firstRequest) await firstRequest.catch(() => {});
    await Promise.all([firstServer.close(), secondServer.close()]);
  }
});

test("expired AI locks can be reclaimed without stale owners clearing a newer lease", async () => {
  const accountId = await createSyntheticLawyer();
  const abandoned = await tryAcquireAiWritingLock(accountId);
  assert.ok(abandoned);

  await db.update(aiRequestLocks).set({
    expiresAt: new Date(Date.now() - 1_000),
  }).where(eq(aiRequestLocks.accountId, accountId));

  const replacement = await tryAcquireAiWritingLock(accountId);
  assert.ok(replacement, "an expired lease left by a crashed instance must be reclaimable");
  await abandoned.release();

  const stillHeld = await tryAcquireAiWritingLock(accountId);
  assert.equal(stillHeld, null, "a stale release must not delete a newer instance's lease");

  await replacement.release();
  const afterRelease = await tryAcquireAiWritingLock(accountId);
  assert.ok(afterRelease, "a released lease should be immediately available to a retry");
  await afterRelease.release();
});

after(async () => {
  try {
    if (syntheticAccountIds.length) {
      await db.delete(aiRequestLocks).where(inArray(aiRequestLocks.accountId, syntheticAccountIds));
      await db.delete(accounts).where(inArray(accounts.id, syntheticAccountIds));
    }
  } finally {
    await pool.end();
  }
});
