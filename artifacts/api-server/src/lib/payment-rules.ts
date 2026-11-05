import { createHmac, timingSafeEqual } from "node:crypto";

export const DAY = 86400000;
export const DOCUMENT_PRICES = { single: 1000, monthly: 49900 } as const;

export function validSignature(payload: string | Buffer, signature: string, secret: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function hasDocumentTrial(createdAt: string, now = Date.now()) {
  return now < new Date(createdAt).getTime() + 2 * DAY;
}

export function hasMonthlyAccess(expiresAt: string | null, now = Date.now()) {
  return !!expiresAt && new Date(expiresAt).getTime() > now;
}

export function unusedDocumentRefund(order: {
  kind: string; status: string; usedCount: number; paidAt: string | null;
}, now = Date.now()) {
  return ["single", "monthly"].includes(order.kind) && order.status === "paid" &&
    order.usedCount === 0 && !!order.paidAt &&
    now < new Date(order.paidAt).getTime() + 7 * DAY;
}
