import { randomUUID } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import { db, accounts, consultations, lawyers, paymentOrders, paymentEvents, notifications } from "@workspace/db";
import { HttpError, type Account } from "../middlewares/access";
import { credentials, razorpay, requireCheckout, providerPayment, type ProviderPayment, type ProviderRefund } from "./razorpay";
import { DAY, DOCUMENT_PRICES, hasMonthlyAccess, unusedDocumentRefund } from "./payment-rules";

type Order = typeof paymentOrders.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Checkout = { plan: "single" | "monthly" | "consultation"; consultationId?: string };

// All billing/document creation paths lock account -> order -> consultation, in
// this order, so payment grants, usage and refunds cannot race.
export async function lockAccount(tx: Tx, id: string) {
  const [account] = await tx.select().from(accounts).where(eq(accounts.id, id)).for("update");
  if (!account) throw new HttpError(404, "Account not found.");
  return account;
}

export async function ownOrder(userId: string, id: string) {
  const [order] = await db.select().from(paymentOrders)
    .where(and(eq(paymentOrders.id, id), eq(paymentOrders.userId, userId)));
  if (!order) throw new HttpError(404, "Payment not found.");
  return order;
}

export async function paymentView(order: Order) {
  let refundable = unusedDocumentRefund(order);
  if (order.kind === "consultation" && order.status === "paid") {
    const [c] = await db.select().from(consultations).where(eq(consultations.id, order.consultationId!));
    refundable = order.refundReason === "service_unavailable" || (c?.status === "cancelled" && c.cancelledBy === "lawyer");
  }
  return { ...order, refundable };
}

export async function createOrder(account: Account, input: Checkout, adminValidation = false) {
  if (adminValidation && (account.role !== "admin" || input.plan !== "single"))
    throw new HttpError(403, "Only an administrator can create a verification purchase.");
  const config = adminValidation ? credentials() : requireCheckout();
  if (adminValidation && !process.env.RAZORPAY_WEBHOOK_SECRET)
    throw new HttpError(503, "Configure the webhook signing secret before running payment verification.");
  return db.transaction(async (tx) => {
    const locked = await lockAccount(tx, account.id);
    let amount: number;
    if (input.plan === "consultation") {
      if (!input.consultationId) throw new HttpError(400, "Choose the consultation to pay for.");
      const [c] = await tx.select().from(consultations)
        .where(and(eq(consultations.id, input.consultationId), eq(consultations.userId, account.id))).for("update");
      if (!c) throw new HttpError(404, "Consultation not found.");
      if (c.demo) throw new HttpError(409, "Illustrative profiles cannot accept payments.");
      if (c.status !== "requested" || new Date(c.startsAt).getTime() <= Date.now())
        throw new HttpError(409, "This consultation is no longer payable.");
      if (["paid", "refund_pending", "refunded"].includes(c.paymentStatus))
        throw new HttpError(409, "This consultation already has a payment.");
      const [lawyer] = await tx.select().from(lawyers).where(eq(lawyers.id, c.lawyerId));
      const [owner] = lawyer?.ownerId ? await tx.select().from(accounts).where(eq(accounts.id, lawyer.ownerId)) : [];
      if (!lawyer || lawyer.demo || lawyer.approvalStatus !== "approved" || !owner || owner.status !== "active")
        throw new HttpError(409, "The assigned lawyer is not currently accepting paid consultations.");
      amount = c.fee * 100;
    } else {
      if (account.role !== "lawyer" && !adminValidation) throw new HttpError(403, "Document plans require a lawyer account.");
      if (input.consultationId) throw new HttpError(400, "Document plans do not take a consultation reference.");
      if (input.plan === "monthly" && hasMonthlyAccess(locked.subscriptionExpiresAt))
        throw new HttpError(409, "Your 30-day plan is still active. Renew after it expires; there is no automatic renewal.");
      amount = DOCUMENT_PRICES[input.plan];
    }
    if (!Number.isSafeInteger(amount) || amount < 100) throw new HttpError(400, "Invalid payment amount.");
    const [existing] = await tx.select().from(paymentOrders).where(and(
      eq(paymentOrders.userId, account.id), eq(paymentOrders.kind, input.plan),
      eq(paymentOrders.mode, config.mode), eq(paymentOrders.status, "pending"),
      input.consultationId ? eq(paymentOrders.consultationId, input.consultationId) : undefined,
    )).orderBy(desc(paymentOrders.createdAt)).limit(1);
    // Reuse unpaid orders even after browser dismissal; an order can be paid only once.
    if (existing) return checkoutView(existing, config.keyId);
    const id = randomUUID();
    const provider = await razorpay<{ id: string; amount: number; currency: string; status: string }>("/orders", {
      amount, currency: "INR", receipt: id, partial_payment: false,
      notes: { app: "consult-lawyer-separate", purchase: id },
    });
    if (!/^order_[a-zA-Z0-9]+$/.test(provider.id) || provider.amount !== amount || provider.currency !== "INR")
      throw new HttpError(502, "Razorpay returned an unexpected order. Checkout was not opened.");
    const [order] = await tx.insert(paymentOrders).values({
      id, userId: account.id, kind: input.plan, consultationId: input.consultationId,
      amount, mode: config.mode, providerOrderId: provider.id,
    }).returning();
    if (input.consultationId) await tx.update(consultations).set({ paymentStatus: "pending" })
      .where(eq(consultations.id, input.consultationId));
    return checkoutView(order, config.keyId);
  });
}

function checkoutView(order: Order, keyId: string) {
  return { id: order.id, keyId, providerOrderId: order.providerOrderId, amount: order.amount, currency: order.currency, mode: order.mode };
}

function checkPayment(order: Order, payment: ProviderPayment) {
  if (order.mode !== credentials().mode || payment.order_id !== order.providerOrderId ||
      payment.amount !== order.amount || payment.currency !== order.currency ||
      (order.providerPaymentId && order.providerPaymentId !== payment.id))
    throw new HttpError(409, "The payment does not match this order.");
  if (!["captured", "refunded"].includes(payment.status) || payment.captured !== true)
    throw new HttpError(409, "Payment is not captured yet. No access has been granted. Check again shortly.");
  if (payment.amount_refunded > 0 && payment.amount_refunded !== order.amount)
    throw new HttpError(409, "A partial refund requires owner reconciliation.");
}

export async function applyCaptured(payment: ProviderPayment, event?: { id: string; name: string }) {
  const [found] = await db.select().from(paymentOrders).where(eq(paymentOrders.providerOrderId, payment.order_id));
  if (!found) return null; // A dedicated account may still contain unrelated legacy orders.
  return db.transaction(async (tx) => {
    await lockAccount(tx, found.userId);
    const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, found.id)).for("update");
    checkPayment(order, payment);
    if (event) {
      const [inserted] = await tx.insert(paymentEvents).values({ id: event.id, event: event.name }).onConflictDoNothing().returning();
      if (!inserted) return order;
    }
    if (order.status !== "pending") return order; // Monotonic: duplicates cannot regrant/refund twice.
    const now = new Date().toISOString();
    const alreadyRefunded = payment.amount_refunded === order.amount;
    let entitlementEndsAt: string | undefined;
    let refundReason: string | undefined;
    if (alreadyRefunded) {
      if (order.consultationId) await tx.update(consultations).set({ paymentStatus: "refunded" }).where(eq(consultations.id, order.consultationId));
    } else if (order.kind === "single") {
      await tx.update(accounts).set({ documentCredits: sql`${accounts.documentCredits} + 1` }).where(eq(accounts.id, order.userId));
    } else if (order.kind === "monthly") {
      // Overlapping paid orders are possible after a very delayed capture. Preserve
      // each paid 30-day period rather than silently discarding a second payment.
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, order.userId));
      const start = Math.max(Date.now(), new Date(account.subscriptionExpiresAt ?? now).getTime());
      entitlementEndsAt = new Date(start + 30 * DAY).toISOString();
      await tx.update(accounts).set({ subscriptionPlan: "monthly", subscriptionExpiresAt: entitlementEndsAt }).where(eq(accounts.id, order.userId));
    } else {
      const [c] = await tx.select().from(consultations).where(eq(consultations.id, order.consultationId!)).for("update");
      const [lawyer] = await tx.select().from(lawyers).where(eq(lawyers.id, c.lawyerId));
      const [owner] = lawyer?.ownerId ? await tx.select().from(accounts).where(eq(accounts.id, lawyer.ownerId)) : [];
      if (c.status === "cancelled" || new Date(c.startsAt).getTime() <= Date.now() ||
          !lawyer || lawyer.demo || lawyer.approvalStatus !== "approved" || !owner || owner.status !== "active")
        refundReason = "service_unavailable";
      await tx.update(consultations).set({
        paymentStatus: "paid", ...(refundReason && c.status === "requested" ? { status: "cancelled" as const } : {}),
      }).where(eq(consultations.id, c.id));
    }
    const [updated] = await tx.update(paymentOrders).set({
      status: alreadyRefunded ? "refunded" : "paid", providerPaymentId: payment.id, paidAt: now, entitlementEndsAt, refundReason,
    }).where(eq(paymentOrders.id, order.id)).returning();
    await tx.insert(notifications).values({
      id: randomUUID(), userId: order.userId, title: order.mode === "test" ? "Test payment verified" : "Payment verified",
      body: alreadyRefunded ? "Razorpay reports this payment as fully refunded. No access was granted."
        : refundReason ? "Payment arrived after the consultation became unavailable. Request a full refund in your payment history."
        : order.kind === "consultation" ? "Your payment is captured. The lawyer must still accept the request."
        : order.kind === "single" ? "One document credit has been added." : "Your 30-day document entitlement has been added.",
      link: order.consultationId ? `/consultations/${order.consultationId}` : "/plans",
    });
    return updated;
  });
}

export async function reconcileOrder(order: Order) {
  if (order.mode !== credentials().mode) throw new HttpError(409, "This payment belongs to a different Razorpay mode.");
  if (order.status === "refund_pending") return requestRefund(order.userId, order.id);
  if (order.status !== "pending") return order;
  const response = await razorpay<{ items: ProviderPayment[] }>(`/orders/${order.providerOrderId}/payments`);
  const captured = response.items.find((p) => ["captured", "refunded"].includes(p.status));
  return captured ? (await applyCaptured(await providerPayment(captured.id)))! : order;
}

async function revokeEntitlement(tx: Tx, order: Order) {
  if (order.kind === "single") {
    // A provider-dashboard refund of a consumed credit creates a debt, not a free credit.
    await tx.update(accounts).set({ documentCredits: sql`${accounts.documentCredits} - 1` }).where(eq(accounts.id, order.userId));
  } else if (order.kind === "monthly") {
    // Remove only this order's 30 days, preserving any later paid periods.
    await tx.update(accounts).set({
      subscriptionExpiresAt: sql`${accounts.subscriptionExpiresAt} - interval '30 days'`,
    }).where(eq(accounts.id, order.userId));
  }
}

export async function requestRefund(userId: string, id: string) {
  const order = await db.transaction(async (tx) => {
    await lockAccount(tx, userId);
    const [o] = await tx.select().from(paymentOrders)
      .where(and(eq(paymentOrders.id, id), eq(paymentOrders.userId, userId))).for("update");
    if (!o) throw new HttpError(404, "Payment not found.");
    if (o.mode !== credentials().mode) throw new HttpError(409, "This payment belongs to a different Razorpay mode.");
    if (o.status === "refunded" || o.status === "refund_pending") return o;
    let eligible = unusedDocumentRefund(o);
    if (o.kind === "consultation" && o.status === "paid") {
      const [c] = await tx.select().from(consultations).where(eq(consultations.id, o.consultationId!)).for("update");
      eligible = o.refundReason === "service_unavailable" || (c.status === "cancelled" && c.cancelledBy === "lawyer");
    }
    if (!eligible) throw new HttpError(409, "This payment is not eligible under the refund policy. Unused document purchases have a seven-day window; consultation refunds require lawyer cancellation.");
    await revokeEntitlement(tx, o);
    if (o.consultationId) await tx.update(consultations).set({ paymentStatus: "refund_pending" }).where(eq(consultations.id, o.consultationId));
    const [updated] = await tx.update(paymentOrders).set({ status: "refund_pending" }).where(eq(paymentOrders.id, id)).returning();
    return updated;
  });
  if (order.status === "refunded") return order;
  // Reserve a single attempt in the DB BEFORE the external call. On ambiguous
  // timeout we reconcile by receipt, never blindly submit another refund.
  const refunds = await razorpay<{ items: ProviderRefund[] }>(`/payments/${order.providerPaymentId}/refunds?count=100`);
  const existing = refunds.items.find((r) => r.status !== "failed" && (
    r.receipt === order.id || r.id === order.providerRefundId ||
    (r.payment_id === order.providerPaymentId && r.amount === order.amount)));
  if (existing) return applyRefund(existing);
  const [attempt] = await db.update(paymentOrders).set({ refundRequestedAt: new Date().toISOString() })
    .where(and(eq(paymentOrders.id, id), sql`${paymentOrders.refundRequestedAt} IS NULL`)).returning();
  if (!attempt) throw new HttpError(503, "Refund is awaiting Razorpay confirmation. No duplicate refund was submitted. Check again or ask the platform owner to reconcile it.");
  const refund = await razorpay<ProviderRefund>(`/payments/${order.providerPaymentId}/refund`, {
    amount: order.amount, speed: "normal", receipt: order.id, notes: { purchase: order.id },
  });
  return applyRefund(refund);
}

export async function applyRefund(refund: ProviderRefund, event?: { id: string; name: string }) {
  if (!/^rfnd_[a-zA-Z0-9]+$/.test(refund.id) || !["pending", "processed", "failed"].includes(refund.status))
    throw new HttpError(502, "Razorpay returned an unexpected refund state.");
  const [found] = await db.select().from(paymentOrders).where(eq(paymentOrders.providerPaymentId, refund.payment_id));
  if (!found) throw new HttpError(409, "Refund payment has not been applied yet. Retry the event after payment capture.");
  if (refund.amount !== found.amount) throw new HttpError(409, "Partial refunds require owner reconciliation; access was not changed.");
  return db.transaction(async (tx) => {
    await lockAccount(tx, found.userId);
    const [order] = await tx.select().from(paymentOrders).where(eq(paymentOrders.id, found.id)).for("update");
    if (event) {
      const [inserted] = await tx.insert(paymentEvents).values({ id: event.id, event: event.name }).onConflictDoNothing().returning();
      if (!inserted) return order;
    }
    if (order.status === "refunded") return order;
    if (refund.status === "failed") {
      // A definitive failure is different from a timeout. Restore reserved access
      // exactly once and allow another eligible attempt; never restore on ambiguity.
      if (order.status !== "refund_pending" || (order.providerRefundId && order.providerRefundId !== refund.id)) return order;
      if (order.kind === "single") await tx.update(accounts).set({ documentCredits: sql`${accounts.documentCredits} + 1` }).where(eq(accounts.id, order.userId));
      if (order.kind === "monthly") await tx.update(accounts).set({
        subscriptionExpiresAt: sql`${accounts.subscriptionExpiresAt} + interval '30 days'`,
      }).where(eq(accounts.id, order.userId));
      const [restored] = await tx.update(paymentOrders).set({
        status: "paid", providerRefundId: null, refundRequestedAt: null,
      }).where(eq(paymentOrders.id, order.id)).returning();
      if (order.consultationId) await tx.update(consultations).set({ paymentStatus: "paid" }).where(eq(consultations.id, order.consultationId));
      return restored;
    }
    if (order.status === "paid") await revokeEntitlement(tx, order);
    const status = refund.status === "processed" ? "refunded" : "refund_pending";
    const [updated] = await tx.update(paymentOrders).set({
      status, providerRefundId: refund.id,
    }).where(eq(paymentOrders.id, order.id)).returning();
    if (order.consultationId) await tx.update(consultations).set({ paymentStatus: status }).where(eq(consultations.id, order.consultationId));
    return updated;
  });
}
