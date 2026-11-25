import assert from "node:assert/strict";
import { test } from "node:test";
import { createOwnerSystemStatusGuard } from "../middlewares/access";

function createTestGuard(options: Parameters<typeof createOwnerSystemStatusGuard>[0] = {}) {
  return createOwnerSystemStatusGuard({
    ...options,
    getUserId: (req) => (req as unknown as { userId: string | null }).userId,
  });
}

async function invoke(guard: ReturnType<typeof createOwnerSystemStatusGuard>, userId: string | null) {
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
  const request = {
    userId,
    log: { warn() {} },
  };

  await guard(
    request as never,
    response as never,
    () => { continued = true; },
  );
  return { statusCode, responseBody, continued };
}

test("system status is denied to a signed-in non-owner", async () => {
  const guard = createTestGuard({
    verifyDatabaseOwner: async () => false,
    verifyConfiguredOwner: async () => false,
  });
  const result = await invoke(guard, "regular-admin");

  assert.equal(result.statusCode, 403);
  assert.equal(result.continued, false);
  assert.deepEqual(result.responseBody, {
    error: "Only the owner-designated administrator can view system status.",
  });
});

test("the owner can still read status during an outage after database verification", async () => {
  let databaseAvailable = true;
  const guard = createTestGuard({
    verifyDatabaseOwner: async () => {
      if (!databaseAvailable) throw new Error("private database connection detail");
      return true;
    },
    verifyConfiguredOwner: async () => false,
  });

  assert.equal((await invoke(guard, "owner")).continued, true);
  databaseAvailable = false;
  assert.equal((await invoke(guard, "owner")).continued, true);
});

test("the configured verified owner can open status during an outage after a restart", async () => {
  const guard = createTestGuard({
    verifyDatabaseOwner: async () => { throw new Error("private database URL"); },
    verifyConfiguredOwner: async (userId) => userId === "configured-owner",
  });
  const result = await invoke(guard, "configured-owner");

  assert.equal(result.statusCode, 200);
  assert.equal(result.continued, true);
});

test("status remains unavailable rather than exposing database details when owner access cannot be verified", async () => {
  const guard = createTestGuard({
    verifyDatabaseOwner: async () => { throw new Error("postgres://private-user:secret@host/db"); },
    verifyConfiguredOwner: async () => false,
  });
  const result = await invoke(guard, "unknown-user");

  assert.equal(result.statusCode, 503);
  assert.equal(result.continued, false);
  assert.deepEqual(result.responseBody, {
    error: "System status is unavailable until owner access can be verified.",
  });
  assert.doesNotMatch(JSON.stringify(result.responseBody), /postgres|secret|host\/db/);
});

test("sign-in is required before reading system status", async () => {
  const guard = createTestGuard({
    verifyDatabaseOwner: async () => { throw new Error("must not be called"); },
    verifyConfiguredOwner: async () => false,
  });
  const result = await invoke(guard, null);

  assert.equal(result.statusCode, 401);
  assert.equal(result.continued, false);
});
