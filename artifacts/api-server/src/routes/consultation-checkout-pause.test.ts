import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import express, { type RequestHandler } from "express";
import { eq, inArray } from "drizzle-orm";
import {
  accounts,
  auditLogs,
  consultationCheckoutControl,
  consultations,
  db,
  lawyers,
  notifications,
  pool,
} from "@workspace/db";
import { apiErrorHandler, type Account } from "../middlewares/access";
import { createConsultationsRouter } from "./consultations";
import { availableSlots } from "../lib/legal";
import { setConsultationCheckoutPaused } from "../lib/consultation-checkout";

assert.equal(process.env.NODE_ENV, "test");

const prefix = `checkout-pause-${randomUUID()}`;
const clientId = `${prefix}-client`;
const adminId = `${prefix}-admin`;
const realLawyerOwnerId = `${prefix}-real-owner`;
const demoLawyerOwnerId = `${prefix}-demo-owner`;
const realLawyerId = `${prefix}-real-profile`;
const demoLawyerId = `${prefix}-demo-profile`;
const fixtureAccountIds = [clientId, adminId, realLawyerOwnerId, demoLawyerOwnerId];
const fixtureAccounts = new Map<string, Account>();
let originalCheckoutControl: typeof consultationCheckoutControl.$inferSelect | null = null;
let server: Server | undefined;
let baseUrl = "";

async function createAccount(id: string, role: Account["role"]) {
  const [account] = await db.insert(accounts).values({
    id,
    role,
    name: `Checkout pause ${role}`,
    email: `${id}@example.invalid`,
  }).returning();
  fixtureAccounts.set(id, account);
  return account;
}

async function requestAs(accountId: string, path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-account-id": accountId },
    body: JSON.stringify(body),
  });
}

function dateKeyInTwoDays() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + 2 * 86400_000));
}

before(async () => {
  const [priorCheckoutControl] = await db.select().from(consultationCheckoutControl)
    .where(eq(consultationCheckoutControl.id, "platform")).limit(1);
  originalCheckoutControl = priorCheckoutControl ?? null;

  await createAccount(clientId, "client");
  await createAccount(adminId, "admin");
  await createAccount(realLawyerOwnerId, "lawyer");
  await createAccount(demoLawyerOwnerId, "lawyer");
  await db.insert(lawyers).values([
    {
      id: realLawyerId,
      ownerId: realLawyerOwnerId,
      name: "Synthetic real advocate",
      title: "Advocate",
      bio: "Synthetic paid consultation test profile.",
      practiceAreas: ["Civil Law"],
      languages: ["English"],
      experienceYears: 1,
      barCouncil: "Synthetic Council",
      enrollmentNumber: `${prefix}-real`,
      fee: 999,
      city: "Synthetic City",
      availability: [0, 1, 2, 3, 4, 5, 6],
      approvalStatus: "approved",
    },
    {
      id: demoLawyerId,
      ownerId: demoLawyerOwnerId,
      name: "Synthetic demo advocate",
      title: "Illustrative profile",
      bio: "Synthetic demo consultation test profile.",
      practiceAreas: ["Civil Law"],
      languages: ["English"],
      experienceYears: 1,
      barCouncil: "Synthetic Council",
      enrollmentNumber: `${prefix}-demo`,
      fee: 999,
      city: "Synthetic City",
      availability: [0, 1, 2, 3, 4, 5, 6],
      approvalStatus: "approved",
      demo: true,
    },
  ]);

  const auth: RequestHandler = (req, res, next) => {
    const account = fixtureAccounts.get(req.get("x-test-account-id") ?? "");
    if (!account) {
      res.status(401).json({ error: "Synthetic account required." });
      return;
    }
    req.account = account;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use(createConsultationsRouter({ authMiddlewares: [auth] }));
  app.use(apiErrorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve);
    server!.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) {
    server.close();
    await new Promise<void>((resolve) => server!.once("close", resolve));
  }
  await db.delete(notifications).where(inArray(notifications.userId, fixtureAccountIds));
  await db.delete(consultations).where(inArray(consultations.userId, fixtureAccountIds));
  await db.delete(lawyers).where(inArray(lawyers.id, [realLawyerId, demoLawyerId]));
  await db.delete(auditLogs).where(inArray(auditLogs.actorId, fixtureAccountIds));
  await db.delete(consultationCheckoutControl).where(eq(consultationCheckoutControl.id, "platform"));
  if (originalCheckoutControl) {
    await db.insert(consultationCheckoutControl).values(originalCheckoutControl).onConflictDoUpdate({
      target: consultationCheckoutControl.id,
      set: originalCheckoutControl,
    });
  }
  await db.delete(accounts).where(inArray(accounts.id, fixtureAccountIds));
  await pool.end();
});

test("paused checkout blocks new real requests, preserves paid appointments, and allows labelled demos", async () => {
  const date = dateKeyInTwoDays();
  const realLawyer = (await db.select().from(lawyers).where(eq(lawyers.id, realLawyerId)))[0]!;
  const demoLawyer = (await db.select().from(lawyers).where(eq(lawyers.id, demoLawyerId)))[0]!;
  const realSlots = await availableSlots(realLawyer, date);
  const demoSlots = await availableSlots(demoLawyer, date);
  assert.ok(realSlots.length >= 2);
  assert.ok(demoSlots.length >= 1);

  const paidConsultationId = randomUUID();
  await db.insert(consultations).values({
    id: paidConsultationId,
    userId: clientId,
    lawyerId: realLawyerId,
    topic: "Existing paid appointment",
    mode: "chat",
    package: "consultation_only",
    status: "booked",
    paymentStatus: "paid",
    startsAt: realSlots[0]!,
    endsAt: new Date(Date.parse(realSlots[0]!) + 30 * 60_000).toISOString(),
    fee: 999,
  });

  await setConsultationCheckoutPaused(adminId, true, "Synthetic staffing pause");
  const blockedResponse = await requestAs(clientId, "/consultations", {
    lawyerId: realLawyerId,
    startsAt: realSlots[1],
    topic: "A new paid consultation",
    mode: "chat",
    package: "consultation_only",
  });
  assert.equal(blockedResponse.status, 503);
  assert.match((await blockedResponse.json() as { error: string }).error, /temporarily unavailable while checkout is paused/);
  const afterBlockedRequest = await db.select().from(consultations).where(eq(consultations.userId, clientId));
  assert.deepEqual(afterBlockedRequest.map((row) => row.id), [paidConsultationId]);
  assert.equal((await db.select().from(notifications).where(inArray(notifications.userId, fixtureAccountIds))).length, 0);
  const [paidUnchanged] = await db.select().from(consultations).where(eq(consultations.id, paidConsultationId));
  assert.equal(paidUnchanged.status, "booked");
  assert.equal(paidUnchanged.paymentStatus, "paid");

  const demoResponse = await requestAs(clientId, "/consultations", {
    lawyerId: demoLawyerId,
    startsAt: demoSlots[0],
    topic: "A labelled demo request",
    mode: "chat",
    package: "consultation_only",
  });
  assert.equal(demoResponse.status, 201);
  const demoConsultation = await demoResponse.json() as { id: string; demo: boolean };
  assert.equal(demoConsultation.demo, true);

  await setConsultationCheckoutPaused(adminId, false, "Synthetic staffing restored");
  const resumedResponse = await requestAs(clientId, "/consultations", {
    lawyerId: realLawyerId,
    startsAt: realSlots[1],
    topic: "A real consultation after checkout resumes",
    mode: "chat",
    package: "consultation_only",
  });
  assert.equal(resumedResponse.status, 201);
  const resumedConsultation = await resumedResponse.json() as { id: string; demo: boolean; paymentStatus: string };
  assert.equal(resumedConsultation.demo, false);
  assert.equal(resumedConsultation.paymentStatus, "unpaid");
  assert.deepEqual(
    (await db.select({ status: consultations.status, paymentStatus: consultations.paymentStatus })
      .from(consultations).where(eq(consultations.id, paidConsultationId))),
    [{ status: "booked", paymentStatus: "paid" }],
  );
});
