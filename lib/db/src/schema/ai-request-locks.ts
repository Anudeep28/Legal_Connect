import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// Stores only the active account lease; never store prompts or matter content here.
export const aiRequestLocks = pgTable("ai_request_locks", {
  accountId: text("account_id").primaryKey().references(() => accounts.id, { onDelete: "cascade" }),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
