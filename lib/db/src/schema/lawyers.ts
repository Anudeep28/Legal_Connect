import { pgTable, text, integer, boolean } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

export const lawyers = pgTable("lawyers", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").unique().references(() => accounts.id),
  name: text("name").notNull(),
  title: text("title").notNull(),
  bio: text("bio").notNull(),
  practiceAreas: text("practice_areas").array().notNull(),
  languages: text("languages").array().notNull(),
  experienceYears: integer("experience_years").notNull(),
  barCouncil: text("bar_council").notNull(),
  enrollmentNumber: text("enrollment_number").notNull().unique(),
  fee: integer("fee").notNull(),
  documentFeePercent: integer("document_fee_percent").notNull().default(50),
  verified: boolean("verified").notNull().default(false),
  approvalStatus: text("approval_status").$type<"pending" | "approved" | "rejected">().notNull().default("pending"),
  online: boolean("online").notNull().default(false),
  city: text("city").notNull(),
  avatarUrl: text("avatar_url").notNull().default(""),
  demo: boolean("demo").notNull().default(false),
  availability: integer("availability").array().notNull(),
  rejectionReason: text("rejection_reason").notNull().default(""),
});
