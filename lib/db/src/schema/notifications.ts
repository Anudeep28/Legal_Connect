import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  read: boolean("read").notNull().default(false),
  link: text("link").notNull().default("/notifications"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("notifications_owner").on(t.userId, t.createdAt)]);
