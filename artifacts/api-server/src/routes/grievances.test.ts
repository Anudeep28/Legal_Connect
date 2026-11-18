import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import express from "express";
import { and, eq, inArray } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://grievance-test:grievance-test@127.0.0.1:1/grievance_test";
const { accounts, auditLogs, db, grievances, pool } = await import("@workspace/db");
const { requireAdmin, apiErrorHandler } = await import("../middlewares/access");
const { createGrievancesRouter } = await import("./grievances");
const { createAdminGrievancesRouter } = await import("./admin-grievances");

const prefix = `grievance_${randomUUID()}`;
const clientId = `${prefix}_client`;
const otherClientId = `${prefix}_other`;
const lawyerId = `${prefix}_lawyer`;
const ownerId = `${prefix}_owner`;
const otherAdminId = `${prefix}_admin`;
const grievanceIds: string[] = [];
const accountIds = [clientId, otherClientId, lawyerId, ownerId, otherAdminId];
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl = "";

before(async () => {
  await db.insert(accounts).values([
    { id: clientId, email: `${clientId}@example.invalid`, name: "Grievance Client" },
    { id: otherClientId, email: `${otherClientId}@example.invalid`, name: "Other Client" },
    { id: lawyerId, email: `${lawyerId}@example.invalid`, name: "Test Lawyer", role: "lawyer" },
    { id: ownerId, email: `${ownerId}@example.invalid`, name: "Designated Owner", role: "admin" },
    { id: otherAdminId, email: `${otherAdminId}@example.invalid`, name: "Other Administrator", role: "admin" },
  ]);
  await db.insert(auditLogs).values({
    id: randomUUID(), actorId: ownerId, targetId: ownerId, action: "admin:owner-designated", reason: "Test fixture",
  });

  const byId = new Map((await db.select().from(accounts).where(inArray(accounts.id, accountIds))).map((account) => [account.id, account]));
  const auth: RequestHandler = (req, res, next) => {
    const account = byId.get(req.get("x-test-account") ?? "");
    if (!account) { res.status(401).json({ error: "Missing test account" }); return; }
    req.account = account;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(createGrievancesRouter({ authMiddlewares: [auth] }));
  app.use(createAdminGrievancesRouter({ authMiddlewares: [auth, requireAdmin] }));
  app.use(apiErrorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

async function call(path: string, accountId: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "x-test-account": accountId, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  return { response, body: await response.json() as any };
}

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (accountIds.length) {
    await db.delete(grievances).where(inArray(grievances.clientId, accountIds));
    await db.delete(auditLogs).where(and(
      inArray(auditLogs.actorId, accountIds),
      eq(auditLogs.action, "admin:owner-designated"),
    ));
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, [...accountIds, ...grievanceIds]));
    await db.delete(accounts).where(inArray(accounts.id, accountIds));
  }
  await pool.end();
});

test("clients submit and track only their own minimal grievance records", async () => {
  const created = await call("/grievances", clientId, {
    method: "POST",
    body: JSON.stringify({ category: "payment", description: "I need help understanding a payment status." }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.category, "payment");
  assert.equal(created.body.status, "submitted");
  const id = created.body.id as string;
  grievanceIds.push(id);
  assert.equal("clientId" in created.body, false);
  assert.equal("consultationId" in created.body, false);

  const ownList = await call("/grievances", clientId);
  assert.equal(ownList.response.status, 200);
  assert.equal((ownList.body as Record<string, any>[]).length, 1);
  const otherList = await call("/grievances", otherClientId);
  assert.equal(otherList.response.status, 200);
  assert.deepEqual(otherList.body, []);

  const nonClient = await call("/grievances", lawyerId, {
    method: "POST",
    body: JSON.stringify({ category: "other", description: "A lawyer cannot submit in the client grievance flow." }),
  });
  assert.equal(nonClient.response.status, 403);
});

test("only the owner-designated grievance reviewer can read and resolve submissions", async () => {
  const clientSubmission = await call("/grievances", clientId, {
    method: "POST",
    body: JSON.stringify({ category: "privacy", description: "Please help with my privacy request." }),
  });
  assert.equal(clientSubmission.response.status, 201);
  const id = clientSubmission.body.id as string;
  grievanceIds.push(id);

  const denied = await call("/admin/grievances", otherAdminId);
  assert.equal(denied.response.status, 403);
  const visible = await call("/admin/grievances", ownerId);
  assert.equal(visible.response.status, 200);
  assert.ok((visible.body as Record<string, any>[]).some((row) => row.id === id && row.clientEmail === `${clientId}@example.invalid`));

  const resolved = await call(`/admin/grievances/${id}`, ownerId, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved", response: "We reviewed this request and have completed the update." }),
  });
  assert.equal(resolved.response.status, 200);
  assert.equal(resolved.body.status, "resolved");
  assert.equal(resolved.body.officerResponse, "We reviewed this request and have completed the update.");

  const clientView = await call("/grievances", clientId);
  const visibleToClient = (clientView.body as Record<string, any>[]).find((row) => row.id === id);
  assert.equal(visibleToClient?.status, "resolved");
  assert.equal(visibleToClient?.officerResponse, "We reviewed this request and have completed the update.");

  const reopened = await call(`/admin/grievances/${id}`, ownerId, {
    method: "PATCH",
    body: JSON.stringify({ status: "under_review" }),
  });
  assert.equal(reopened.response.status, 409);
});
