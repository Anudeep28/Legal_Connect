import { Router, type IRouter, type RequestHandler } from "express";
import { eq, desc } from "drizzle-orm";
import { rateLimit } from "express-rate-limit";
import { db, paymentOrders } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { requireAccount, requireAdmin, HttpError } from "../middlewares/access";
import { credentials, providerPayment, razorpay, type ProviderRefund } from "../lib/razorpay";
import { validSignature } from "../lib/payment-rules";
import { createOrder, ownOrder, applyCaptured, paymentView, reconcileOrder, requestRefund, applyRefund } from "../lib/payments";

const router: IRouter = Router();
router.use("/billing", requireAccount);
router.use("/billing", rateLimit({ windowMs: 60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }));

router.post("/billing/checkout", async (req, res) => {
  res.json(api.CreateCheckoutResponse.parse(await createOrder(req.account, api.CreateCheckoutBody.parse(req.body))));
});
router.post("/billing/validation-checkout", requireAdmin, async (req, res) => {
  const input = api.CreateValidationCheckoutBody.parse(req.body);
  if (!input.approveCharge) throw new HttpError(400, "Explicit approval of the verification purchase is required.");
  res.json(api.CreateValidationCheckoutResponse.parse(await createOrder(req.account, { plan: "single" }, true)));
});
router.post("/billing/verify", async (req, res) => {
  const input = api.VerifyPaymentBody.parse(req.body);
  const order = await ownOrder(req.account.id, input.id);
  const config = credentials();
  if (order.mode !== config.mode) throw new HttpError(409, "Payment mode does not match the current credentials.");
  // Use our stored order reference, never an order reference supplied by the browser.
  if (!validSignature(`${order.providerOrderId}|${input.paymentId}`, input.signature, config.keySecret))
    throw new HttpError(400, "Payment signature verification failed. No access was granted.");
  const updated = await applyCaptured(await providerPayment(input.paymentId));
  if (!updated || updated.id !== order.id) throw new HttpError(409, "Payment does not match the purchase.");
  res.json(api.VerifyPaymentResponse.parse(await paymentView(updated)));
});
router.get("/billing/payments", async (req, res) => {
  const orders = await db.select().from(paymentOrders).where(eq(paymentOrders.userId, req.account.id))
    .orderBy(desc(paymentOrders.createdAt)).limit(100);
  res.json(api.ListPaymentsResponse.parse(await Promise.all(orders.map(paymentView))));
});
router.post("/billing/payments/:id/reconcile", async (req, res) => {
  const { id } = api.ReconcilePaymentParams.parse(req.params);
  res.json(api.ReconcilePaymentResponse.parse(await paymentView(await reconcileOrder(await ownOrder(req.account.id, id)))));
});
router.post("/billing/payments/:id/refund", async (req, res) => {
  const { id } = api.RefundPaymentParams.parse(req.params);
  res.json(api.RefundPaymentResponse.parse(await paymentView(await requestRefund(req.account.id, id))));
});

// Mounted before JSON parsing, cookies, Clerk and CSRF: HMAC authenticates this
// one public endpoint. No other billing route bypasses account/origin checks.
export const razorpayWebhook: RequestHandler = async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, "Payment webhook is not configured.");
  if (!Buffer.isBuffer(req.body) || !validSignature(req.body, req.get("X-Razorpay-Signature") ?? "", secret))
    throw new HttpError(400, "Invalid webhook signature.");
  const eventId = req.get("x-razorpay-event-id");
  if (!eventId || eventId.length > 200) throw new HttpError(400, "Missing webhook event reference.");
  let body: { event?: string; payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
    refund?: { entity?: { id?: string; payment_id?: string } };
  } };
  try { body = JSON.parse(req.body.toString("utf8")); } catch { throw new HttpError(400, "Invalid webhook payload."); }
  if (!body || typeof body.event !== "string") throw new HttpError(400, "Invalid webhook event.");
  const event = { id: eventId, name: body.event };
  if (["payment.captured", "order.paid"].includes(body.event)) {
    const paymentId = body.payload?.payment?.entity?.id;
    if (!paymentId) throw new HttpError(400, "Missing payment reference.");
    await applyCaptured(await providerPayment(paymentId), event);
  } else if (["refund.created", "refund.processed", "refund.failed"].includes(body.event)) {
    const refundId = body.payload?.refund?.entity?.id;
    const paymentId = body.payload?.refund?.entity?.payment_id;
    if (!refundId || !/^rfnd_[a-zA-Z0-9]+$/.test(refundId) || !paymentId) throw new HttpError(400, "Invalid refund reference.");
    const payment = await providerPayment(paymentId);
    // Recover capture even if the refund webhook arrives before payment.captured.
    const [known] = await db.select().from(paymentOrders).where(eq(paymentOrders.providerOrderId, payment.order_id));
    if (known) {
      await applyCaptured(payment);
      const refund = await razorpay<ProviderRefund>(`/refunds/${refundId}`);
      if (refund.payment_id !== paymentId) throw new HttpError(409, "Refund does not match the payment.");
      await applyRefund(refund, event);
    }
  }
  res.json({ received: true });
};

export default router;
