import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accounts } from "./accounts";

export const aiUsageLimits = pgTable("ai_usage_limits", {
  id: text("id").primaryKey().default("platform"),
  draftingTrial: integer("drafting_trial").notNull().default(5),
  draftingSingle: integer("drafting_single").notNull().default(15),
  draftingMonthly: integer("drafting_monthly").notNull().default(30),
  transcriptionTrial: integer("transcription_trial").notNull().default(5),
  transcriptionSingle: integer("transcription_single").notNull().default(15),
  transcriptionMonthly: integer("transcription_monthly").notNull().default(30),
  configuredBy: text("configured_by").references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  check("ai_usage_limits_range_check", sql`
    ${table.draftingTrial} BETWEEN 0 AND 10000 AND
    ${table.draftingSingle} BETWEEN 0 AND 10000 AND
    ${table.draftingMonthly} BETWEEN 0 AND 10000 AND
    ${table.transcriptionTrial} BETWEEN 0 AND 10000 AND
    ${table.transcriptionSingle} BETWEEN 0 AND 10000 AND
    ${table.transcriptionMonthly} BETWEEN 0 AND 10000
  `),
]);
