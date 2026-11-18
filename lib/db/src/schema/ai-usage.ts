import { pgTable, text, integer, date, numeric, primaryKey } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// No prompt text or case facts belong in usage counters.
export const aiUsage = pgTable("ai_usage", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"drafting" | "transcription">().notNull(),
  day: date("day", { mode: "string" }).notNull(),
  used: integer("used").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.accountId, table.kind, table.day] })]);

// Daily operational aggregates only; never store prompts, transcripts, or case facts.
export const aiUsageDaily = pgTable("ai_usage_daily", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"deepseek" | "elevenlabs">().notNull(),
  day: date("day", { mode: "string" }).notNull(),
  requests: integer("requests").notNull().default(0),
  successfulRequests: integer("successful_requests").notNull().default(0),
  tokenUsageRequests: integer("token_usage_requests").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  pricedRequests: integer("priced_requests").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 20, scale: 12, mode: "number" }),
}, (table) => [primaryKey({ columns: [table.accountId, table.provider, table.day] })]);
