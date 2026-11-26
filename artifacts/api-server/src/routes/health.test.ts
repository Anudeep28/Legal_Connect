import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { test } from "node:test";

test("full API serves health without production credentials or database access", async () => {
  process.env.DATABASE_URL = "postgres://smoke:smoke@127.0.0.1:1/isolated_smoke";
  process.env.CLERK_PUBLISHABLE_KEY = "pk_test_smoke";
  process.env.CLERK_SECRET_KEY = "sk_test_smoke";
  delete process.env.OWNER_ADMIN_BOOTSTRAP_EMAIL;
  const { default: app } = await import("../app");
  const { pool } = await import("@workspace/db");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });

    const readiness = await fetch(`http://127.0.0.1:${address.port}/api/readyz`);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), { status: "not_ready", database: "unavailable" });
  } finally {
    server.close();
    await once(server, "close");
    await pool.end();
  }
});
