import { HttpError } from "../middlewares/access";

export type PaymentMode = "test" | "live";
export type ProviderPayment = {
  id: string; order_id: string; amount: number; currency: string;
  status: string; captured: boolean; amount_refunded: number; created_at: number;
};
export type ProviderRefund = { id: string; payment_id: string; amount: number; status: string; receipt?: string };

export function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const mode: PaymentMode | null = keyId?.startsWith("rzp_test_") ? "test" : keyId?.startsWith("rzp_live_") ? "live" : null;
  if (!keyId || !keySecret || !mode)
    throw new HttpError(503, "Razorpay credentials have not been configured for this separate app. No payment was taken.");
  return { keyId, keySecret, mode };
}

// Adding keys alone must never enable checkout. Set this only AFTER real provider
// checkout, capture, signature and webhook checks have passed for the matching mode.
export function paymentsEnabled(): boolean {
  try {
    return credentials().mode === process.env.RAZORPAY_CHECKOUT_VERIFIED_MODE &&
      Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
  } catch { return false; }
}

export function requireCheckout() {
  if (!paymentsEnabled())
    throw new HttpError(503, "Checkout is disabled until Razorpay checkout and webhooks are verified for this separate app. No payment was taken.");
  return credentials();
}

export async function razorpay<T>(path: string, body?: object): Promise<T> {
  const { keyId, keySecret } = credentials();
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(503, "Razorpay could not be reached. Check payment history before trying again.");
  }
  if (!response.ok) {
    // Provider errors may contain personal or credential data; do not log/forward.
    throw new HttpError(502, "Razorpay could not confirm this request. Check payment history or contact the platform owner.");
  }
  return response.json() as Promise<T>;
}

export async function providerPayment(paymentId: string) {
  if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new HttpError(400, "Invalid payment reference.");
  return razorpay<ProviderPayment>(`/payments/${paymentId}`);
}
