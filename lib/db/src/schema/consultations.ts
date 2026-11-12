import { sql } from "drizzle-orm";
import { pgTable, text, integer, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { lawyers } from "./lawyers";

export const consultations = pgTable("consultations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  lawyerId: text("lawyer_id").notNull().references(() => lawyers.id),
  topic: text("topic").notNull(),
  notes: text("notes").notNull().default(""),
  mode: text("mode").$type<"chat" | "call">().notNull(),
  package: text("package").$type<"consultation_only" | "consultation_document">().notNull(),
  status: text("status").$type<"requested" | "booked" | "cancelled" | "completed">().notNull().default("requested"),
  paymentStatus: text("payment_status").$type<"unpaid" | "pending" | "paid" | "refund_pending" | "refunded">().notNull().default("unpaid"),
  cancelledBy: text("cancelled_by").$type<"client" | "lawyer">(),
  startsAt: timestamp("starts_at", { withTimezone: true, mode: "string" }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true, mode: "string" }).notNull(),
  fee: integer("fee").notNull(),
  transcript: text("transcript").notNull().default(""),
  callRoomSid: text("call_room_sid"),
  demo: boolean("demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("consultation_active_slot").on(t.lawyerId, t.startsAt).where(sql`${t.status} <> 'cancelled'`),
  index("consultation_user").on(t.userId),
]);

export const messages = pgTable("consultation_messages", {
  id: text("id").primaryKey(),
  consultationId: text("consultation_id").notNull().references(() => consultations.id, { onDelete: "cascade" }),
  sender: text("sender").$type<"client" | "lawyer" | "system">().notNull(),
  senderName: text("sender_name").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("messages_consultation").on(t.consultationId, t.createdAt)]);

export const deliverables = pgTable("deliverables", {
  id: text("id").primaryKey(),
  consultationId: text("consultation_id").notNull().references(() => consultations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  status: text("status").$type<"draft" | "delivered">().notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

// Consent is specific to each token issuance. Recording is never enabled.
export const callConsents = pgTable("consultation_call_consents", {
  id: text("id").primaryKey(),
  consultationId: text("consultation_id").notNull().references(() => consultations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => accounts.id),
  policyVersion: text("policy_version").notNull().default("audio-only-no-recording-v1"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const reviews = pgTable("lawyer_reviews", {
  id: text("id").primaryKey(),
  consultationId: text("consultation_id").notNull().unique().references(() => consultations.id),
  lawyerId: text("lawyer_id").notNull().references(() => lawyers.id),
  userId: text("user_id").notNull().references(() => accounts.id),
  clientName: text("client_name").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull(),
  visible: boolean("visible").notNull().default(true),
  moderationReason: text("moderation_reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
