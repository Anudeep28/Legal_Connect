import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import express from "express";
import { inArray } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://workspace-test:workspace-test@127.0.0.1:1/workspace_test";
const { accounts, consultations, consultationAttachments, lawyers, db, notifications, pool } = await import("@workspace/db");
const { apiErrorHandler } = await import("../middlewares/access");
const { createConsultationWorkspaceRouter } = await import("./consultation-workspace");
const { parseActionPlanDraft } = await import("../lib/action-plan");
const { ObjectNotFoundError } = await import("../lib/objectStorage");

const prefix = `plan_${randomUUID()}`;
const clientId = `${prefix}_client`;
const otherId = `${prefix}_other`;
const lawyerAccountId = `${prefix}_lawyer`;
const lawyerId = `${prefix}_profile`;
const consultationId = `${prefix}_consultation`;
const accountIds = [clientId, otherId, lawyerAccountId];
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let baseUrl = "";

// In-memory stand-in for App Storage: tests never touch the real bucket.
const objects = new Map<string, { size: number; contentType: string }>();
let nextObject = "";
const fakeStorage = {
  async getObjectEntityUploadURL() {
    nextObject = `uploads/${randomUUID()}`;
    return `https://storage.googleapis.com/test-bucket/private/${nextObject}?sig=1`;
  },
  normalizeObjectEntityPath() { return `/objects/${nextObject}`; },
  async getObjectEntityFile(path: string) {
    const meta = objects.get(path);
    if (!meta) throw new ObjectNotFoundError();
    return { getMetadata: async () => [meta], delete: async () => { objects.delete(path); } } as never;
  },
};

before(async () => {
  await db.insert(accounts).values([
    { id: clientId, email: `${clientId}@example.invalid`, name: "Plan Client" },
    { id: otherId, email: `${otherId}@example.invalid`, name: "Other Client" },
    { id: lawyerAccountId, email: `${lawyerAccountId}@example.invalid`, name: "Plan Lawyer", role: "lawyer" },
  ]);
  await db.insert(lawyers).values({
    id: lawyerId, ownerId: lawyerAccountId, name: "Plan Lawyer", title: "Advocate", bio: "Test", practiceAreas: ["civil"],
    languages: ["English"], experienceYears: 5, barCouncil: "Test Bar", enrollmentNumber: `${prefix}_enrol`, fee: 500,
    city: "Pune", availability: [1, 2, 3], approvalStatus: "approved",
  });
  const start = new Date(Date.now() + 86400000).toISOString();
  await db.insert(consultations).values({
    id: consultationId, userId: clientId, lawyerId, topic: "Deposit dispute", mode: "chat", package: "consultation_only",
    status: "requested", startsAt: start, endsAt: start, fee: 500,
  });
  const byId = new Map((await db.select().from(accounts).where(inArray(accounts.id, accountIds))).map((a) => [a.id, a]));
  const auth: RequestHandler = (req, res, next) => {
    const account = byId.get(req.get("x-test-account") ?? "");
    if (!account) { res.status(401).json({ error: "Missing test account" }); return; }
    req.account = account;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { warn() {}, info() {}, error() {} }; next(); });
  app.use(createConsultationWorkspaceRouter({ authMiddlewares: [auth], storage: fakeStorage as never }));
  app.use(apiErrorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
  await db.delete(notifications).where(inArray(notifications.userId, accountIds));
  await db.delete(consultations).where(inArray(consultations.id, [consultationId]));
  await db.delete(lawyers).where(inArray(lawyers.id, [lawyerId]));
  await db.delete(accounts).where(inArray(accounts.id, accountIds));
  await pool.end();
});

async function call(path: string, accountId: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "x-test-account": accountId, ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

const base = `/consultations/${consultationId}`;
const plan = (status: "draft" | "published", reviewConfirmed = false) => JSON.stringify({
  summary: "Send a legal notice before filing.", status, reviewConfirmed, aiAssisted: false,
  steps: [{ text: "Collect the rent agreement", owner: "client", dueDate: "2026-12-05" }, { text: "Draft the notice", owner: "lawyer" }],
  documentsNeeded: ["Rent agreement"], templateIds: ["legal-notice", "not-a-template"],
});

test("only the client edits the brief and only participants see attachments", async () => {
  const denied = await call(`${base}/brief`, lawyerAccountId, { method: "PUT", body: JSON.stringify({ whatHappened: "x" }) });
  assert.equal(denied.response.status, 403);
  const saved = await call(`${base}/brief`, clientId, { method: "PUT", body: JSON.stringify({ whatHappened: " Landlord kept deposit ", keyDates: "1 Oct: moved out" }) });
  assert.equal(saved.response.status, 200);
  assert.equal(saved.body.brief.whatHappened, "Landlord kept deposit");

  const ticket = await call(`${base}/attachments`, clientId, { method: "POST", body: JSON.stringify({ name: "agreement.pdf", size: 1000, contentType: "application/pdf" }) });
  assert.equal(ticket.response.status, 201);
  const pendingList = await call(`${base}/attachments`, lawyerAccountId);
  assert.deepEqual(pendingList.body, []);
  const notUploaded = await call(`${base}/attachments/${ticket.body.attachmentId}/confirm`, clientId, { method: "POST" });
  assert.equal(notUploaded.response.status, 409);
  objects.set(`/objects/${nextObject}`, { size: 1000, contentType: "application/pdf" });
  const confirmed = await call(`${base}/attachments/${ticket.body.attachmentId}/confirm`, clientId, { method: "POST" });
  assert.equal(confirmed.response.status, 200);
  assert.equal(confirmed.body.uploadedBy, "client");
  const lawyerList = await call(`${base}/attachments`, lawyerAccountId);
  assert.equal(lawyerList.body.length, 1);
  const outsider = await call(`${base}/attachments`, otherId);
  assert.equal(outsider.response.status, 404);

  const wrongType = await call(`${base}/attachments`, clientId, { method: "POST", body: JSON.stringify({ name: "x.exe", size: 10, contentType: "application/x-msdownload" }) });
  assert.equal(wrongType.response.status, 400);

  const removed = await call(`${base}/attachments/${ticket.body.attachmentId}`, clientId, { method: "DELETE" });
  assert.equal(removed.response.status, 204);
  assert.equal(objects.size, 0);
  await db.delete(consultationAttachments).where(inArray(consultationAttachments.consultationId, [consultationId]));
});

test("plans need an accepted consultation, stay hidden as drafts and require review to publish", async () => {
  const early = await call(`${base}/action-plan`, lawyerAccountId, { method: "PUT", body: plan("draft") });
  assert.equal(early.response.status, 409);
  await db.update(consultations).set({ status: "booked" }).where(inArray(consultations.id, [consultationId]));

  const byClient = await call(`${base}/action-plan`, clientId, { method: "PUT", body: plan("draft") });
  assert.equal(byClient.response.status, 403);
  const draft = await call(`${base}/action-plan`, lawyerAccountId, { method: "PUT", body: plan("draft") });
  assert.equal(draft.response.status, 200);
  assert.deepEqual(draft.body.templateIds, ["legal-notice"]);
  const hidden = await call(`${base}/action-plan`, clientId);
  assert.equal(hidden.body, null);

  const unreviewed = await call(`${base}/action-plan`, lawyerAccountId, { method: "PUT", body: plan("published") });
  assert.equal(unreviewed.response.status, 409);
  const published = await call(`${base}/action-plan`, lawyerAccountId, { method: "PUT", body: plan("published", true) });
  assert.equal(published.response.status, 200);
  assert.ok(published.body.lawyerReviewedAt);
  const unpublish = await call(`${base}/action-plan`, lawyerAccountId, { method: "PUT", body: plan("draft") });
  assert.equal(unpublish.response.status, 409);

  const visible = await call(`${base}/action-plan`, clientId);
  assert.equal(visible.body.status, "published");
  const [clientStep, lawyerStep] = visible.body.steps;
  const tick = await call(`${base}/action-plan/steps/${clientStep.id}`, clientId, { method: "PATCH", body: JSON.stringify({ done: true }) });
  assert.equal(tick.response.status, 200);
  assert.equal(tick.body.steps[0].done, true);
  const notMine = await call(`${base}/action-plan/steps/${lawyerStep.id}`, clientId, { method: "PATCH", body: JSON.stringify({ done: true }) });
  assert.equal(notMine.response.status, 403);
});

test("AI plan output is parsed defensively", () => {
  assert.equal(parseActionPlanDraft("not json"), null);
  const parsed = parseActionPlanDraft('```json\n{"summary":"S","steps":[{"text":"Do it","owner":"client"},{"text":"x","owner":"lawyer","dueDate":"soon"}],"templateIds":["legal-notice","fake"]}\n```');
  assert.ok(parsed);
  assert.equal(parsed.steps[0].dueDate, null);
  assert.equal(parsed.steps[1].dueDate, null);
  assert.deepEqual(parsed.templateIds, ["legal-notice"]);
  assert.deepEqual(parsed.documentsNeeded, []);
});
