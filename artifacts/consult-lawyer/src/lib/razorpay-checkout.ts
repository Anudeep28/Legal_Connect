import type { CheckoutOrder } from '@workspace/api-client-react';

type PaymentResult = { razorpay_payment_id: string; razorpay_signature: string };
type CheckoutInstance = { open(): void; close(): void; on(event: string, handler: () => void): void };
type CheckoutConstructor = new (options: Record<string, unknown>) => CheckoutInstance;
declare global { interface Window { Razorpay?: CheckoutConstructor } }

let scriptPromise: Promise<void> | undefined;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    const timer = setTimeout(() => { script.remove(); scriptPromise = undefined; reject(new Error('Razorpay did not load. Check your connection and retry from payment history.')); }, 20000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); scriptPromise = undefined; reject(new Error('Razorpay could not load. No payment was confirmed.')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// Browser callbacks never grant access: the supplied verifier must ask our server.
export async function openCheckout(order: CheckoutOrder, verify: (result: PaymentResult) => Promise<boolean>): Promise<boolean> {
  await loadCheckout();
  if (!window.Razorpay) throw new Error('Razorpay is unavailable. No payment was confirmed.');
  return new Promise<boolean>((resolve, reject) => {
    let processing = false;
    let settled = false;
    const checkout = new window.Razorpay!({
      key: order.keyId, order_id: order.providerOrderId,
      amount: order.amount, currency: order.currency,
      name: 'Consult with Lawyer',
      description: order.mode === 'test' ? 'TEST MODE — no real payment' : 'Legal services',
      handler: async (result: PaymentResult) => {
        if (settled) return;
        processing = true;
        try { const paid = await verify(result); settled = true; resolve(paid); }
        catch (error) { settled = true; reject(error); }
      },
      modal: { ondismiss: () => { if (!processing && !settled) { settled = true; resolve(false); } } },
    });
    checkout.on('payment.failed', () => {
      if (settled || processing) return;
      settled = true;
      checkout.close();
      reject(new Error('Payment was not confirmed. Check payment history before retrying.'));
    });
    checkout.open();
  });
}
