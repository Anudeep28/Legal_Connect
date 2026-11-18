import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const grievanceCategories = ["account", "consultation", "payment", "privacy", "other"] as const;
export const grievanceStatuses = ["submitted", "under_review", "resolved"] as const;

export const grievances = pgTable("grievances", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull().references(() => accounts.id),
  category: text("category").$type<(typeof grievanceCategories)[number]>().notNull(),
  description: text("description").notNull(),
  status: text("status").$type<(typeof grievanceStatuses)[number]>().notNull().default("submitted"),
  officerResponse: text("officer_response").notNull().default(""),
  respondedBy: text("responded_by").references(() => accounts.id),
  respondedAt: timestamp("responded_at", { withTimezone: true, mode: "string" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
}, (table) => [index("grievances_client_timeline").on(table.clientId, table.submittedAt)]);
