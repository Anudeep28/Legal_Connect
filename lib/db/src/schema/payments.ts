import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { consultations } from "./consultations";

// Store references and entitlement accounting only, never card/bank details or signatures.
export const paymentOrders = pgTable("payment_orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  kind: text("kind").$type<"single" | "monthly" | "consultation">().notNull(),
  consultationId: text("consultation_id").references(() => consultations.id),
  amount: integer("amount").notNull(), // paise; determined by the server
  currency: text("currency").notNull().default("INR"),
  mode: text("mode").$type<"test" | "live">().notNull(),
  status: text("status").$type<"pending" | "paid" | "refund_pending" | "refunded">().notNull().default("pending"),
  providerOrderId: text("provider_order_id").notNull().unique(),
  providerPaymentId: text("provider_payment_id").unique(),
  usedCount: integer("used_count").notNull().default(0),
  paidAt: timestamp("paid_at", { withTimezone: true, mode: "string" }),
  entitlementEndsAt: timestamp("entitlement_ends_at", { withTimezone: true, mode: "string" }),
  refundReason: text("refund_reason"),
  refundRequestedAt: timestamp("refund_requested_at", { withTimezone: true, mode: "string" }),
  providerRefundId: text("provider_refund_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("payment_orders_user").on(t.userId)]);

export const paymentEvents = pgTable("payment_events", {
  id: text("id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
