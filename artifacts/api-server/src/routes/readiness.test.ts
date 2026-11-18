import assert from "node:assert/strict";
import { once } from "node:events";
import express, { type IRouter } from "express";
import { test } from "node:test";

process.env.DATABASE_URL = "postgres://readiness:readiness@127.0.0.1:1/isolated_readiness";
const {
  API_READINESS_TIMEOUT_MS,
  DATABASE_READINESS_QUERY_TIMEOUT_MS,
  createDatabaseReadinessProbe,
  createHealthRouter,
} = await import("./health");

async function requestReadiness(router: IRouter) {
  const app = express();
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await fetch(`http://127.0.0.1:${address.port}/api/readyz`, {
      signal: AbortSignal.timeout(API_READINESS_TIMEOUT_MS + 1_000),
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("readiness succeeds after a bounded read-only database probe", async () => {
  const queries: { text: string; query_timeout: number }[] = [];
  const checkDatabase = createDatabaseReadinessProbe(async (query) => {
    queries.push(query);
    return { rows: [{ "?column?": 1 }] };
  });
  const response = await requestReadiness(createHealthRouter(checkDatabase));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "ready", database: "ok" });
  assert.deepEqual(queries, [{
    text: "SELECT 1",
    query_timeout: DATABASE_READINESS_QUERY_TIMEOUT_MS,
  }]);
});

test("readiness returns a safe unavailable response when the database probe fails", async () => {
  const response = await requestReadiness(createHealthRouter(async () => {
    throw new Error("private database connection detail");
  }));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "not_ready", database: "unavailable" });
});

test("readiness stays bounded when a database probe stalls", async () => {
  const timeoutMs = 25;
  const startedAt = Date.now();
  const response = await requestReadiness(createHealthRouter(
    () => new Promise(() => {}),
    timeoutMs,
  ));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "not_ready", database: "unavailable" });
  assert.ok(Date.now() - startedAt < 1_000, "Readiness should not wait on a stalled database probe.");
});
