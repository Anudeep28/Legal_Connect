import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import express from "express";
import { eq, inArray } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://checkout-history-test:checkout-history-test@127.0.0.1:1/checkout_history_test";
const { accounts, auditLogs, db, pool } = await import("@workspace/db");
const { apiErrorHandler, requireAdmin } = await import("../middlewares/access");
const { createAdminConsultationCheckoutHistoryRouter } = await import("./admin");

const prefix = `checkout_history_${randomUUID()}`;
const ownerId = `${prefix}_owner`;
const otherAdminId = `${prefix}_admin`;
const accountIds = [ownerId, otherAdminId];
const auditIds = [randomUUID(), randomUUID(), randomUUID()];
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl = "";

before(async () => {
  const resumedAt = new Date();
  const pausedAt = new Date(resumedAt.getTime() - 60_000);
  await db.insert(accounts).values([
    { id: ownerId, email: `${ownerId}@example.invalid`, name: "Checkout Owner", role: "admin" },
    { id: otherAdminId, email: `${otherAdminId}@example.invalid`, name: "Other Admin", role: "admin" },
  ]);
  await db.insert(auditLogs).values([
    {
      id: auditIds[0]!,
      actorId: ownerId,
      targetId: ownerId,
      action: "admin:owner-designated",
      reason: "Synthetic test owner designation",
    },
    {
      id: auditIds[1]!,
      actorId: ownerId,
      targetId: "platform",
      action: "billing:consultation-checkout-paused",
      reason: "Paid consultation checkout paused: Synthetic provider outage",
      createdAt: pausedAt.toISOString(),
    },
    {
      id: auditIds[2]!,
      actorId: ownerId,
      targetId: "platform",
      action: "billing:consultation-checkout-resumed",
      reason: "Paid consultation checkout resumed: Synthetic provider recovered",
      createdAt: resumedAt.toISOString(),
    },
  ]);

  const byId = new Map((await db.select().from(accounts).where(inArray(accounts.id, accountIds)))
    .map((account) => [account.id, account]));
  const auth: RequestHandler = (req, res, next) => {
    const account = byId.get(req.get("x-test-account") ?? "");
    if (!account) {
      res.status(401).json({ error: "Missing test account" });
      return;
    }
    req.account = account;
    next();
  };

  const app = express();
  app.use(createAdminConsultationCheckoutHistoryRouter([auth, requireAdmin]));
  app.use(apiErrorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

async function request(accountId: string) {
  return fetch(`${baseUrl}/admin/consultation-checkout-history`, {
    headers: { "x-test-account": accountId },
  });
}

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.delete(auditLogs).where(inArray(auditLogs.id, auditIds));
  await db.delete(accounts).where(inArray(accounts.id, accountIds));
  await pool.end();
});

test("the owner can review recent pause and resume history with actor, reason, and timestamp", async () => {
  const response = await request(ownerId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json() as {
    events: Array<{
      id: string;
      action: "paused" | "resumed";
      reason: string;
      changedAt: string;
      actorName: string;
      actorEmail: string;
    }>;
  };
  const resumeIndex = result.events.findIndex((event) => event.id === auditIds[2]);
  const pauseIndex = result.events.findIndex((event) => event.id === auditIds[1]);
  assert.ok(resumeIndex >= 0, "the resume event should be returned");
  assert.ok(pauseIndex > resumeIndex, "events should be sorted newest first");
  const resume = result.events[resumeIndex]!;
  const pause = result.events[pauseIndex]!;
  assert.deepEqual([resume.action, resume.reason], ["resumed", "Synthetic provider recovered"]);
  assert.deepEqual([pause.action, pause.reason], ["paused", "Synthetic provider outage"]);
  assert.ok([resume, pause].every((event) =>
    event.actorName === "Checkout Owner" &&
    event.actorEmail === `${ownerId}@example.invalid` &&
    Number.isFinite(Date.parse(event.changedAt)),
  ));
});

test("other administrators cannot access consultation checkout history", async () => {
  const response = await request(otherAdminId);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "Only the owner-designated administrator has access to this setting.",
  });
});
