import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").$type<"client" | "lawyer" | "admin">().notNull().default("client"),
  status: text("status").$type<"active" | "suspended" | "deactivated">().notNull().default("active"),
  emailNotifications: boolean("email_notifications").notNull().default(false),
  pushNotifications: boolean("push_notifications").notNull().default(false),
  phone: text("phone"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true, mode: "string" }),
  subscriptionPlan: text("subscription_plan").notNull().default("trial"),
  subscriptionExpiresAt: timestamp("subscription_expires_at", { withTimezone: true, mode: "string" }),
  documentCredits: integer("document_credits").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  actorId: text("actor_id").notNull().references(() => accounts.id),
  targetId: text("target_id").notNull(),
  action: text("action").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
