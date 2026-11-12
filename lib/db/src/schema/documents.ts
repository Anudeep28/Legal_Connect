import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const documents = pgTable("legal_documents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => accounts.id),
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  templateId: text("template_id").notNull().default(""),
  category: text("category").notNull().default("General"),
  language: text("language").notNull().default("English"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (t) => [index("documents_owner").on(t.userId, t.updatedAt)]);
