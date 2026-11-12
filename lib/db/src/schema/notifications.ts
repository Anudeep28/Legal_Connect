import { pgTable, text, boolean, timestamp, index, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { consultations } from "./consultations";

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").notNull().default(false),
  link: text("link").notNull().default("/notifications"),
  eventKey: text("event_key").unique(),
  consultationId: text("consultation_id").references(() => consultations.id, { onDelete: "cascade" }),
  reminderStartsAt: timestamp("reminder_starts_at", { withTimezone: true, mode: "string" }),
  reminderLeadMinutes: integer("reminder_lead_minutes"),
  outboundQueuedAt: timestamp("outbound_queued_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("notifications_owner").on(t.userId, t.createdAt)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("push_subscription_owner").on(t.userId)]);

export const communicationDeliveries = pgTable("communication_deliveries", {
  id: text("id").primaryKey(),
  notificationId: text("notification_id").notNull().references(() => notifications.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  channel: text("channel").$type<"email" | "push">().notNull(),
  // Stable subscription ID, not endpoint/key material. Retain history if subscription expires.
  destination: text("destination").notNull(),
  // Freeze provider payload for safe retries with the same idempotency key.
  emailTo: text("email_to"),
  emailFrom: text("email_from"),
  emailText: text("email_text"),
  status: text("status").$type<"pending" | "processing" | "retry" | "blocked" | "accepted" | "skipped" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true, mode: "string" }),
  lockToken: text("lock_token"),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true, mode: "string" }),
  providerId: text("provider_id"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("delivery_event_channel_destination").on(t.notificationId, t.channel, t.destination),
  index("delivery_due").on(t.status, t.nextAttemptAt),
]);

export const phoneChallenges = pgTable("phone_verification_challenges", {
  userId: text("user_id").primaryKey().references(() => accounts.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  providerSid: text("provider_sid"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true, mode: "string" }).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true, mode: "string" }).notNull(),
  requests: integer("requests").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
});
