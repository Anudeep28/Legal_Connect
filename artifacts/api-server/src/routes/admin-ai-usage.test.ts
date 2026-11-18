import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgres://admin-ai-usage-test:admin-ai-usage-test@127.0.0.1:1/admin_ai_usage_test";
const { requireOwnerAdmin } = await import("../middlewares/access");

test("owner-only AI usage access rejects an administrator without the owner designation", async () => {
  let statusCode = 200;
  let responseBody: unknown;
  let continued = false;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  };
  const request = { account: { id: `synthetic-${randomUUID()}`, role: "admin" } };

  await requireOwnerAdmin(
    request as never,
    response as never,
    () => { continued = true; },
  );

  assert.equal(statusCode, 403);
  assert.equal(continued, false);
  assert.deepEqual(responseBody, {
    error: "Only the owner-designated administrator has access to this setting.",
  });
});
