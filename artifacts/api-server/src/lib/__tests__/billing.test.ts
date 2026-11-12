import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import express from "express";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, accounts, consultations, lawyers, documents, paymentOrders, paymentEvents, notifications } from "@workspace/db";
import { validSignature, DAY, hasDocumentTrial, hasMonthlyAccess, unusedDocumentRefund } from "../payment-rules";
import { createOrder, applyCaptured, ownOrder, requestRefund, applyRefund, paymentView } from "../payments";
import { paymentsEnabled, requireCheckout, type ProviderPayment, type ProviderRefund } from "../razorpay";
import { insertDocumentWithAccess } from "../../routes/documents";
import { razorpayWebhook } from "../../routes/billing";
import { apiErrorHandler } from "../../middlewares/access";

// Explicit, isolated synthetic credentials. This suite never sends traffic to
// Razorpay and never persists activation flags. Run against the pilot DEV DB only.
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.RAZORPAY_KEY_ID, "rzp_test_fixture");
const userIds: string[] = [];
const eventIds: string[] = [];
const providerPayments = new Map<string, ProviderPayment>();
const providerRefunds: ProviderRefund[] = [];
let orderCounter = 0;
let refundCalls = 0;
let refundTimeout = false;
let server: Server;
let url: string;
const originalFetch = globalThis.fetch;

before(async () => {
  globalThis.fetch = async (input, init) => {
    const target = new URL(String(input));
    assert.equal(target.origin, "https://api.razorpay.com", "No real network requests are permitted in billing tests");
    assert.ok(new Headers(init?.headers).get("Authorization")?.startsWith("Basic "));
    const path = target.pathname.replace("/v1", "");
    if (path === "/orders" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return Response.json({ id: `order_Fixture${++orderCounter}`, ...body, status: "created" });
    }
    if (/^\/orders\/[^/]+\/payments$/.test(path)) {
      return Response.json({ items: [...providerPayments.values()].filter((p) => path.includes(p.order_id)) });
    }
    if (/^\/payments\/[^/]+\/refunds$/.test(path)) {
      return Response.json({ items: providerRefunds.filter((r) => path.includes(r.payment_id)) });
    }
    if (/^\/payments\/[^/]+\/refund$/.test(path)) {
      refundCalls++;
      if (refundTimeout) throw new Error("Synthetic connection timeout");
      const body = JSON.parse(String(init?.body));
      const refund = { id: `rfnd_Fixture${refundCalls}`, payment_id: path.split("/")[2], amount: body.amount, receipt: body.receipt, status: "pending" };
      providerRefunds.push(refund);
      return Response.json(refund);
    }
    if (path.startsWith("/payments/")) {
      const payment = providerPayments.get(path.split("/")[2]);
      assert.ok(payment);
      return Response.json(payment);
    }
    if (path.startsWith("/refunds/")) {
      const refund = providerRefunds.find((r) => path.endsWith(r.id));
      assert.ok(refund);
      return Response.json(refund);
    }
    throw new Error(`Unexpected mocked provider path: ${path}`);
  };
  const app = express();
  app.post("/webhook", express.raw({ type: "application/json" }), razorpayWebhook);
  app.use(apiErrorHandler);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  url = `http://127.0.0.1:${address.port}/webhook`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  // Only remove this run's generated fixture IDs, never shared pilot data.
  if (userIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
    await db.delete(documents).where(inArray(documents.userId, userIds));
    await db.delete(paymentOrders).where(inArray(paymentOrders.userId, userIds));
    await db.delete(consultations).where(inArray(consultations.userId, userIds));
    await db.delete(lawyers).where(inArray(lawyers.ownerId, userIds));
    await db.delete(accounts).where(inArray(accounts.id, userIds));
  }
  if (eventIds.length) await db.delete(paymentEvents).where(inArray(paymentEvents.id, eventIds));
  await pool.end();
});

async function user(role: "client" | "lawyer" | "admin" = "lawyer", ageDays = 5) {
  const id = `billing_fixture_${randomUUID()}`;
  userIds.push(id);
  const [account] = await db.insert(accounts).values({
    id, role, name: "Billing test fixture", email: "billing-fixture@example.invalid",
    createdAt: new Date(Date.now() - ageDays * DAY).toISOString(),
  }).returning();
  return account;
}
function payment(order: { providerOrderId: string; amount: number }, overrides: Partial<ProviderPayment> = {}) {
  const p: ProviderPayment = {
    id: `pay_Fixture${randomUUID().replaceAll("-", "")}`, order_id: order.providerOrderId,
    amount: order.amount, currency: "INR", status: "captured", captured: true, amount_refunded: 0,
    created_at: Math.floor(Date.now() / 1000), ...overrides,
  };
  providerPayments.set(p.id, p);
  return p;
}
function event() {
  const id = `billing_fixture_${randomUUID()}`;
  eventIds.push(id);
  return { id, name: "payment.captured" };
}
async function latestAccount(id: string) {
  const [a] = await db.select().from(accounts).where(eq(accounts.id, id));
  return a;
}
async function document(account: Awaited<ReturnType<typeof user>>) {
  return insertDocumentWithAccess(account, { id: randomUUID(), userId: account.id, title: "Fixture", content: "" });
}

test("signatures and exact trial, plan and seven-day boundaries", () => {
  const signature = createHmac("sha256", "fixture").update("order|payment").digest("hex");
  assert.equal(validSignature("order|payment", signature, "fixture"), true);
  assert.equal(validSignature("other|payment", signature, "fixture"), false);
  assert.equal(validSignature("order|payment", "abc", "fixture"), false);
  assert.equal(validSignature("order|payment", signature, "wrong"), false);
  const now = Date.now();
  assert.equal(hasDocumentTrial(new Date(now - 2 * DAY + 1).toISOString(), now), true);
  assert.equal(hasDocumentTrial(new Date(now - 2 * DAY).toISOString(), now), false);
  assert.equal(hasMonthlyAccess(new Date(now).toISOString(), now), false);
  const o = { kind: "monthly", status: "paid", usedCount: 0, paidAt: new Date(now - 7 * DAY + 1).toISOString() };
  assert.equal(unusedDocumentRefund(o, now), true);
  assert.equal(unusedDocumentRefund({ ...o, usedCount: 1 }, now), false);
  assert.equal(unusedDocumentRefund({ ...o, paidAt: new Date(now - 7 * DAY).toISOString() }, now), false);
});

test("credentials alone do not enable checkout; the verification mode must match", () => {
  delete process.env.RAZORPAY_CHECKOUT_VERIFIED_MODE;
  assert.equal(paymentsEnabled(), false);
  assert.throws(requireCheckout);
  process.env.RAZORPAY_CHECKOUT_VERIFIED_MODE = "live";
  assert.equal(paymentsEnabled(), false);
  process.env.RAZORPAY_CHECKOUT_VERIFIED_MODE = "test";
  assert.equal(paymentsEnabled(), true);
});

test("server creates fixed-price orders and reuses a dismissed/pending order", async () => {
  const a = await user();
  const count = orderCounter;
  const [o, retry] = await Promise.all([createOrder(a, { plan: "single" }), createOrder(a, { plan: "single" })]);
  assert.equal(o.id, retry.id);
  assert.equal(o.amount, 1000);
  assert.equal(orderCounter - count, 1);
  const monthly = await createOrder(a, { plan: "monthly" });
  assert.equal(monthly.amount, 49900);
  const client = await user("client");
  await assert.rejects(createOrder(client, { plan: "monthly" }), /lawyer account/);
  await assert.rejects(ownOrder(client.id, o.id), /not found/);
});

test("only admin validation can create an order while general checkout stays disabled", async () => {
  const admin = await user("admin");
  const lawyer = await user();
  delete process.env.RAZORPAY_CHECKOUT_VERIFIED_MODE;
  try {
    await assert.rejects(createOrder(lawyer, { plan: "single" }), /Checkout is disabled/);
    await assert.rejects(createOrder(lawyer, { plan: "single" }, true), /administrator/);
    await assert.rejects(createOrder(admin, { plan: "monthly" }, true), /administrator/);
    const o = await createOrder(admin, { plan: "single" }, true);
    assert.equal(o.amount, 1000);
    assert.equal(paymentsEnabled(), false);
  } finally { process.env.RAZORPAY_CHECKOUT_VERIFIED_MODE = "test"; }
});

test("authorization and mismatched amounts grant nothing; concurrent captures grant once", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "single" });
  await assert.rejects(applyCaptured(payment(o, { status: "authorized", captured: false })), /not captured/);
  await assert.rejects(applyCaptured(payment(o, { amount: 1 })), /does not match/);
  assert.equal((await latestAccount(a.id)).documentCredits, 0);
  const p = payment(o);
  const e = event();
  await Promise.all(Array.from({ length: 6 }, () => applyCaptured(p, e)));
  assert.equal((await latestAccount(a.id)).documentCredits, 1);
  const results = await Promise.allSettled([document(a), document(a)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const paid = await ownOrder(a.id, o.id);
  assert.equal(paid.usedCount, 1);
  assert.equal((await paymentView(paid)).refundable, false);
  await assert.rejects(requestRefund(a.id, o.id), /not eligible/);
});

test("30-day plan permits creation, records use, expires, and preserves existing documents", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "monthly" });
  const paid = await applyCaptured(payment(o));
  assert.ok(paid?.entitlementEndsAt);
  const days = (new Date(paid.entitlementEndsAt).getTime() - Date.now()) / DAY;
  assert.ok(days > 29.99 && days <= 30);
  await document(a);
  await document(a);
  assert.equal((await ownOrder(a.id, o.id)).usedCount, 2);
  await assert.rejects(requestRefund(a.id, o.id), /not eligible/);
  await assert.rejects(createOrder(a, { plan: "monthly" }), /still active/);
  await db.update(accounts).set({ subscriptionExpiresAt: new Date(Date.now() - 1).toISOString() }).where(eq(accounts.id, a.id));
  await assert.rejects(document(a), /trial has ended/);
  assert.equal((await db.select().from(documents).where(eq(documents.userId, a.id))).length, 2);
});

test("trial is independent of purchased plan and does not consume a credit", async () => {
  const a = await user("lawyer", 1);
  const o = await createOrder(a, { plan: "single" });
  await applyCaptured(payment(o));
  await document(a);
  assert.equal((await latestAccount(a.id)).documentCredits, 1);
  assert.equal((await ownOrder(a.id, o.id)).usedCount, 0);
});

test("document usage and an unused-credit refund cannot both win a race", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "single" });
  await applyCaptured(payment(o));
  const results = await Promise.allSettled([document(a), requestRefund(a.id, o.id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await latestAccount(a.id)).documentCredits, 0);
});

test("refunds revoke once, reconcile repeated requests, and never regrant on late capture", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "single" });
  const p = payment(o);
  await applyCaptured(p);
  const calls = refundCalls;
  const pending = await requestRefund(a.id, o.id);
  assert.equal(pending.status, "refund_pending");
  assert.equal((await latestAccount(a.id)).documentCredits, 0);
  await requestRefund(a.id, o.id);
  assert.equal(refundCalls - calls, 1);
  const refund = providerRefunds.find((r) => r.payment_id === p.id)!;
  refund.status = "processed";
  await applyRefund(refund, { ...event(), name: "refund.processed" });
  await applyCaptured(p, event());
  await applyRefund(refund, { ...event(), name: "refund.processed" });
  assert.equal((await ownOrder(a.id, o.id)).status, "refunded");
  assert.equal((await latestAccount(a.id)).documentCredits, 0);
});

test("ambiguous refund timeout does not submit duplicate requests or restore access", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "single" });
  await applyCaptured(payment(o));
  refundTimeout = true;
  const calls = refundCalls;
  await assert.rejects(requestRefund(a.id, o.id), /could not be reached/);
  refundTimeout = false;
  await assert.rejects(requestRefund(a.id, o.id), /awaiting Razorpay/);
  assert.equal(refundCalls - calls, 1);
  assert.equal((await latestAccount(a.id)).documentCredits, 0);
});

test("definitive failed refund restores reserved access once", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "monthly" });
  const p = payment(o);
  await applyCaptured(p);
  const before = (await latestAccount(a.id)).subscriptionExpiresAt;
  await requestRefund(a.id, o.id);
  const refund = providerRefunds.find((r) => r.payment_id === p.id)!;
  refund.status = "failed";
  await applyRefund(refund);
  await applyRefund(refund);
  assert.equal((await latestAccount(a.id)).subscriptionExpiresAt, before);
  assert.equal((await ownOrder(a.id, o.id)).status, "paid");
});

test("refunded payment delivered before capture cannot grant document access", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "single" });
  await applyCaptured(payment(o, { status: "refunded", amount_refunded: o.amount }));
  assert.equal((await ownOrder(a.id, o.id)).status, "refunded");
  assert.equal((await latestAccount(a.id)).documentCredits, 0);
});

test("consultations use snapshot fee, block demo payments and follow lawyer cancellation policy", async () => {
  const owner = await user();
  const client = await user("client");
  const lawyerId = randomUUID();
  await db.insert(lawyers).values({
    id: lawyerId, ownerId: owner.id, name: "Fixture", title: "Fixture", bio: "Fixture",
    practiceAreas: [], languages: [], experienceYears: 1, barCouncil: "Fixture", enrollmentNumber: randomUUID(),
    fee: 1200, city: "Fixture", availability: [1], approvalStatus: "approved",
  });
  const id = randomUUID();
  await db.insert(consultations).values({
    id, userId: client.id, lawyerId, topic: "Fixture", mode: "chat", package: "consultation_document",
    fee: 1800, startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date(Date.now() + DAY + 1800000).toISOString(),
  });
  const o = await createOrder(client, { plan: "consultation", consultationId: id });
  assert.equal(o.amount, 180000);
  const [pending] = await db.select().from(consultations).where(eq(consultations.id, id));
  assert.equal(pending.paymentStatus, "pending");
  await applyCaptured(payment(o));
  await db.update(consultations).set({ status: "cancelled", cancelledBy: "client" }).where(eq(consultations.id, id));
  await assert.rejects(requestRefund(client.id, o.id), /not eligible/);
  await db.update(consultations).set({ cancelledBy: "lawyer" }).where(eq(consultations.id, id));
  assert.equal((await requestRefund(client.id, o.id)).status, "refund_pending");
  const demoId = randomUUID();
  await db.insert(consultations).values({
    id: demoId, userId: client.id, lawyerId, topic: "Fixture", mode: "chat", package: "consultation_only",
    demo: true, fee: 1200, startsAt: new Date(Date.now() + 2 * DAY).toISOString(), endsAt: new Date(Date.now() + 2 * DAY + 1800000).toISOString(),
  });
  await assert.rejects(createOrder(client, { plan: "consultation", consultationId: demoId }), /Illustrative/);
});

test("raw webhook rejects altered signatures and duplicate events apply only once", async () => {
  const a = await user();
  const o = await createOrder(a, { plan: "single" });
  const p = payment(o);
  const e = event();
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: p.id } } } });
  const signature = createHmac("sha256", "billing-test-only-webhook").update(raw).digest("hex");
  const send = (body = raw, sig = signature) => originalFetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Razorpay-Signature": sig, "x-razorpay-event-id": e.id }, body,
  });
  assert.equal((await send(`${raw} `)).status, 400);
  assert.equal((await send(raw, "wrong")).status, 400);
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  assert.equal((await latestAccount(a.id)).documentCredits, 1);
  const entries = await db.select().from(paymentEvents).where(and(eq(paymentEvents.id, e.id), eq(paymentEvents.event, e.name)));
  assert.equal(entries.length, 1);
});
