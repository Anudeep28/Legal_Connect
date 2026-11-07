import type { Account } from "../middlewares/access";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function callEligibility(
  c: { mode: string; status: string; demo: boolean; paymentStatus: string; startsAt: string; endsAt: string },
  enabled: boolean, now = Date.now(),
) {
  const opensAt = new Date(new Date(c.startsAt).getTime() - 10 * MINUTE).toISOString();
  const closesAt = c.endsAt;
  let reason = "";
  if (!enabled) reason = "Twilio calling is not configured. No call can be placed.";
  else if (c.mode !== "call") reason = "This is a chat consultation.";
  else if (c.demo) reason = "Illustrative profiles cannot join real calls.";
  else if (c.status !== "booked" || c.paymentStatus !== "paid") reason = "A paid consultation accepted by the lawyer is required.";
  else if (now < new Date(opensAt).getTime()) reason = "Calls open 10 minutes before the appointment.";
  else if (now >= new Date(closesAt).getTime()) reason = "The consultation call window has ended.";
  return { enabled, canJoin: !reason, reason, recordingEnabled: false as const, opensAt, closesAt };
}

export function isParticipant(account: Pick<Account, "id">, c: { userId: string; lawyerOwnerId: string | null }) {
  return account.id === c.userId || account.id === c.lawyerOwnerId;
}

// A delayed worker must not send a stale 24-hour reminder just before the session.
export function reminderDue(startsAt: string, minutes: number, now = Date.now()) {
  const start = new Date(startsAt).getTime();
  const due = start - minutes * MINUTE;
  return now >= due && now < Math.min(start, due + (minutes === 1440 ? HOUR : 10 * MINUTE));
}

export function retryDelay(attempts: number) {
  return Math.min(HOUR, 30_000 * 2 ** Math.max(0, attempts - 1));
}

// Never retry email outside Resend's 24-hour idempotency retention period.
export function retryAllowed(attempts: number, firstAttemptAt: string | null, now = Date.now()) {
  return attempts < 10 && (!firstAttemptAt || now - new Date(firstAttemptAt).getTime() < 20 * HOUR);
}

export function validPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    const hosts = ["fcm.googleapis.com", "android.googleapis.com", "web.push.apple.com", "push.services.mozilla.com", "notify.windows.com"];
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
      hosts.some((host) => u.hostname === host || u.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

export function phoneApproved(check: { status: string; valid: boolean; to: string }, expectedPhone: string) {
  return check.status === "approved" && check.valid === true && check.to === expectedPhone;
}
