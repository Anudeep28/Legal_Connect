import { createInsertSchema } from "drizzle-zod";
import { boolean, date, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { accounts } from "./accounts";

export const twilioUsageLookupStatuses = [
  "not_checked",
  "checking",
  "success",
  "partial",
  "no_data",
  "failed",
  "not_configured",
] as const;

export const twilioUsageBudget = pgTable("twilio_usage_budget", {
  id: text("id").primaryKey().default("platform"),
  enabled: boolean("enabled").notNull().default(false),
  budgetAmount: numeric("budget_amount", { precision: 18, scale: 6 }),
  budgetCurrency: text("budget_currency").notNull().default("USD"),
  warningPercent: integer("warning_percent").notNull().default(80),
  lookupStatus: text("lookup_status").$type<(typeof twilioUsageLookupStatuses)[number]>().notNull().default("not_checked"),
  currentSpend: numeric("current_spend", { precision: 18, scale: 6 }),
  usageCurrency: text("usage_currency"),
  participantMinutes: numeric("participant_minutes", { precision: 18, scale: 4 }),
  periodStart: date("period_start", { mode: "string" }),
  periodEnd: date("period_end", { mode: "string" }),
  usageAsOf: timestamp("usage_as_of", { withTimezone: true, mode: "string" }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: "string" }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true, mode: "string" }),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true, mode: "string" }),
  configuredBy: text("configured_by").references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});

export const insertTwilioUsageBudgetSchema = createInsertSchema(twilioUsageBudget).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTwilioUsageBudget = z.infer<typeof insertTwilioUsageBudgetSchema>;
export type TwilioUsageBudget = typeof twilioUsageBudget.$inferSelect;

export const twilioUsageHistoryStatuses = ["success", "partial", "no_data"] as const;

export const twilioUsageHistory = pgTable("twilio_usage_history", {
  periodStart: date("period_start", { mode: "string" }).primaryKey(),
  periodEnd: date("period_end", { mode: "string" }),
  status: text("status").$type<(typeof twilioUsageHistoryStatuses)[number]>().notNull(),
  spend: numeric("spend", { precision: 18, scale: 6 }),
  currency: text("currency"),
  participantMinutes: numeric("participant_minutes", { precision: 18, scale: 4 }),
  usageAsOf: timestamp("usage_as_of", { withTimezone: true, mode: "string" }),
  checkedAt: timestamp("checked_at", { withTimezone: true, mode: "string" }).notNull(),
});

export type TwilioUsageHistory = typeof twilioUsageHistory.$inferSelect;
