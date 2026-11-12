import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import webPush from "web-push";
import {
  db, accounts, consultations, lawyers, notifications, pushSubscriptions, communicationDeliveries,
} from "@workspace/db";
import { emailEnabled, pushEnabled, publicAppUrl } from "./communication-config";
import { HOUR, MINUTE, reminderDue, retryAllowed, retryDelay, validPushEndpoint } from "./communication-policy";
import { closeCallRoom } from "./consultation-calls";
import { logger } from "./logger";

type Delivery = typeof communicationDeliveries.$inferSelect;

// Scheduler inserts only due reminders, never retroactively claims missed reminders.
export async function scheduleReminders(now = Date.now(), consultationIds?: string[]) {
  const rows = await db.select({ c: consultations, ownerId: lawyers.ownerId })
    .from(consultations).innerJoin(lawyers, eq(consultations.lawyerId, lawyers.id))
    .where(and(eq(consultations.status, "booked"), eq(consultations.paymentStatus, "paid"),
      eq(consultations.demo, false), sql`${consultations.startsAt} > ${new Date(now).toISOString()}`,
      sql`${consultations.startsAt} <= ${new Date(now + 24 * HOUR).toISOString()}`,
      consultationIds ? inArray(consultations.id, consultationIds) : undefined));
  for (const { c, ownerId } of rows) {
    for (const minutes of [1440, 10]) {
      if (!reminderDue(c.startsAt, minutes, now)) continue;
      for (const userId of [...new Set([c.userId, ownerId].filter((id): id is string => !!id))]) {
        await db.insert(notifications).values({
          id: randomUUID(), userId, consultationId: c.id, reminderStartsAt: c.startsAt, reminderLeadMinutes: minutes,
          eventKey: `reminder:${c.id}:${new Date(c.startsAt).toISOString()}:${minutes}:${userId}`,
          title: minutes === 1440 ? "Consultation in 24 hours" : "Consultation in 10 minutes",
          body: `Your confirmed consultation is scheduled for ${new Date(c.startsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST. Open it for details.`,
          link: `/consultations/${c.id}`,
        }).onConflictDoNothing();
      }
    }
  }
}

// Persisted notifications are the durable source of outbound jobs, including events
// written inside booking/payment/admin transactions. No fire-and-forget send hooks.
export async function queueOutbound(userIds?: string[]) {
  await db.transaction(async (tx) => {
    const batch = await tx.select().from(notifications).where(and(isNull(notifications.outboundQueuedAt),
      userIds ? inArray(notifications.userId, userIds) : undefined))
      .orderBy(notifications.createdAt).limit(50).for("update", { skipLocked: true });
    for (const n of batch) {
      const [account] = await tx.select().from(accounts).where(eq(accounts.id, n.userId));
      if (account?.status === "active" && Date.now() - new Date(n.createdAt).getTime() < 24 * HOUR) {
        if (account.emailNotifications) {
          await tx.insert(communicationDeliveries).values({
            id: randomUUID(), notificationId: n.id, userId: n.userId, channel: "email",
            destination: "email", emailTo: account.email,
          }).onConflictDoNothing();
        }
        if (account.pushNotifications) {
          const subscriptions = await tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, n.userId));
          for (const subscription of subscriptions) {
            await tx.insert(communicationDeliveries).values({
              id: randomUUID(), notificationId: n.id, userId: n.userId, channel: "push", destination: subscription.id,
            }).onConflictDoNothing();
          }
        }
      }
      await tx.update(notifications).set({ outboundQueuedAt: new Date().toISOString() }).where(eq(notifications.id, n.id));
    }
  });
}

export async function claimDelivery(now = Date.now(), userIds?: string[]) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select().from(communicationDeliveries).where(and(
      lte(communicationDeliveries.nextAttemptAt, new Date(now).toISOString()),
      userIds ? inArray(communicationDeliveries.userId, userIds) : undefined,
      or(inArray(communicationDeliveries.status, ["pending", "retry", "blocked"]),
        and(eq(communicationDeliveries.status, "processing"), lte(communicationDeliveries.lockedUntil, new Date(now).toISOString()))),
    )).orderBy(communicationDeliveries.nextAttemptAt).limit(1).for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await tx.update(communicationDeliveries).set({
      status: "processing", lockedUntil: new Date(now + 2 * MINUTE).toISOString(), lockToken: randomUUID(),
    }).where(eq(communicationDeliveries.id, candidate.id)).returning();
    return claimed;
  });
}

async function finish(job: Delivery, values: Partial<typeof communicationDeliveries.$inferInsert>) {
  await db.update(communicationDeliveries).set({ ...values, lockToken: null, lockedUntil: null }).where(and(
    eq(communicationDeliveries.id, job.id), eq(communicationDeliveries.lockToken, job.lockToken!),
  ));
}

class DeliveryError extends Error {
  constructor(public code: number, public retryable: boolean) { super("Provider rejected request"); }
}

export async function deliver(job: Delivery) {
  const [n] = await db.select().from(notifications).where(eq(notifications.id, job.notificationId));
  const [account] = await db.select().from(accounts).where(eq(accounts.id, job.userId));
  if (!n || !account || account.status !== "active" ||
    (job.channel === "email" ? !account.emailNotifications : !account.pushNotifications)) {
    await finish(job, { status: "skipped", lastError: "Recipient inactive or notification preference disabled." }); return;
  }
  if (n.consultationId && n.reminderStartsAt && n.reminderLeadMinutes) {
    const [c] = await db.select().from(consultations).where(eq(consultations.id, n.consultationId));
    if (!c || c.status !== "booked" || c.paymentStatus !== "paid" || c.demo ||
      new Date(c.startsAt).getTime() !== new Date(n.reminderStartsAt).getTime() ||
      !reminderDue(n.reminderStartsAt, n.reminderLeadMinutes)) {
      await finish(job, { status: "skipped", lastError: "Reminder expired or consultation changed." }); return;
    }
  }
  if (Date.now() - new Date(job.createdAt).getTime() >= 24 * HOUR) {
    await finish(job, { status: "failed", lastError: "Delivery expired; not replayed." }); return;
  }
  if (!retryAllowed(job.attempts, job.firstAttemptAt)) {
    await finish(job, { status: "failed", lastError: "Retry budget exhausted; manual investigation required." }); return;
  }
  if (!(job.channel === "email" ? emailEnabled() : pushEnabled())) {
    await finish(job, { status: "blocked", nextAttemptAt: new Date(Date.now() + 5 * MINUTE).toISOString(), lastError: "Delivery provider is not configured." }); return;
  }
  const attempts = job.attempts + 1;
  const firstAttemptAt = job.firstAttemptAt || new Date().toISOString();
  // Freeze the email payload before the first external request. Retrying with the
  // same idempotency key and a different payload is not safe.
  const emailFrom = job.emailFrom || process.env.EMAIL_FROM!;
  const emailText = job.emailText || `You have an update in Consult with Lawyer. Sign in to view it:\n${publicAppUrl()}${n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications"}\n\nManage email notifications in your account settings.`;
  await db.update(communicationDeliveries).set({
    attempts, firstAttemptAt,
    ...(job.channel === "email" ? { emailFrom, emailText } : {}),
  }).where(and(eq(communicationDeliveries.id, job.id), eq(communicationDeliveries.lockToken, job.lockToken!)));
  try {
    let providerId: string | null = null;
    if (job.channel === "email") {
      // Never redirect an old message to an edited/reused email address.
      if (job.emailTo !== account.email) {
        await finish(job, { status: "skipped", lastError: "Recipient email changed." }); return;
      }
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": job.id },
        body: JSON.stringify({ from: emailFrom, to: [job.emailTo], subject: "Update from Consult with Lawyer", text: emailText }),
      });
      if (!response.ok) throw new DeliveryError(response.status, response.status >= 500 || [408, 409, 429].includes(response.status));
      const data = await response.json() as { id?: string };
      if (!data.id) throw new DeliveryError(502, true);
      providerId = data.id;
    } else {
      const [subscription] = await db.select().from(pushSubscriptions).where(and(
        eq(pushSubscriptions.id, job.destination), eq(pushSubscriptions.userId, job.userId),
      ));
      if (!subscription || !validPushEndpoint(subscription.endpoint)) {
        await finish(job, { status: "skipped", lastError: "Browser subscription removed or invalid." }); return;
      }
      try {
        await webPush.sendNotification({ endpoint: subscription.endpoint, keys: subscription.keys }, JSON.stringify({
          title: "Consult with Lawyer", body: "You have a consultation update. Sign in to view it.",
          // Same notification tag replaces duplicates after ambiguous push acceptance.
          tag: n.id, url: "/notifications",
        }), {
          TTL: 600, timeout: 15_000,
          vapidDetails: { subject: process.env.VAPID_SUBJECT!, publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! },
        });
      } catch (error) {
        const code = (error as { statusCode?: number }).statusCode || 0;
        if ([404, 410].includes(code)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
          await finish(job, { status: "skipped", lastError: "Browser subscription expired; removed." }); return;
        }
        throw new DeliveryError(code, !code || code >= 500 || code === 429);
      }
    }
    await finish(job, { status: "accepted", providerId, lastError: null });
  } catch (error) {
    const retryable = !(error instanceof DeliveryError) || error.retryable;
    await finish(job, {
      status: retryable && retryAllowed(attempts, firstAttemptAt) ? "retry" : "failed",
      nextAttemptAt: new Date(Date.now() + retryDelay(attempts)).toISOString(),
      lastError: error instanceof DeliveryError ? `Provider rejected request (${error.code || "network"}).` : "Provider unavailable or response uncertain.",
    });
  }
}

export async function closeExpiredCalls() {
  const rows = await db.select({ c: consultations, ownerId: lawyers.ownerId, approval: lawyers.approvalStatus }).from(consultations)
    .innerJoin(lawyers, eq(lawyers.id, consultations.lawyerId)).where(sql`${consultations.callRoomSid} IS NOT NULL`);
  for (const { c, ownerId, approval } of rows) {
    const participants = await db.select().from(accounts).where(inArray(accounts.id, [c.userId, ownerId || ""]));
    if (c.status !== "booked" || c.paymentStatus !== "paid" || new Date(c.endsAt).getTime() <= Date.now() ||
      approval !== "approved" || participants.length !== 2 || participants.some((a) => a.status !== "active")) {
      try { await closeCallRoom(c.id); }
      catch { logger.warn({ consultationId: c.id }, "Could not close Twilio room; retrying on next worker tick"); }
    }
  }
}

let running = false;
export async function communicationTick() {
  if (running) return null;
  running = true;
  try {
    await scheduleReminders();
    await queueOutbound();
    await closeExpiredCalls();
    // Bound each tick; multiple instances can claim jobs safely with row leases.
    for (let count = 0; count < 20; count++) {
      const job = await claimDelivery();
      if (!job) break;
      await deliver(job);
    }
    return true;
  } catch {
    // Do not log provider responses, push endpoints, phone numbers or legal content.
    logger.error("Communication worker tick failed; persisted work will be retried");
    return false;
  } finally { running = false; }
}

export function startCommunicationWorker() {
  void communicationTick();
  const timer = setInterval(() => { void communicationTick(); }, 15_000);
  timer.unref();
  return () => clearInterval(timer);
}
