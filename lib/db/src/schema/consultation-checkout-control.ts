import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const consultationCheckoutControl = pgTable("consultation_checkout_control", {
  id: text("id").primaryKey().default("platform"),
  paused: boolean("paused").notNull().default(false),
  reason: text("reason"),
  changedBy: text("changed_by").references(() => accounts.id),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "string" })
    .notNull().defaultNow().$onUpdate(() => new Date().toISOString()),
});
