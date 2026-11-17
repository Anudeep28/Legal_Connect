import { pgTable, text, integer, date, primaryKey } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// No prompt text or case facts belong in usage counters.
export const aiUsage = pgTable("ai_usage", {
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"drafting" | "transcription">().notNull(),
  day: date("day", { mode: "string" }).notNull(),
  used: integer("used").notNull().default(0),
}, (table) => [primaryKey({ columns: [table.accountId, table.kind, table.day] })]);
