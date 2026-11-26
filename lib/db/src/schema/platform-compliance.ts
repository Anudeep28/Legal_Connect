import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { accounts } from "./accounts";

// One current owner-approved legal review record for the platform. Prior
// approvals remain in the admin audit log when this record is replaced.
export const platformCompliance = pgTable("platform_compliance", {
  id: text("id").primaryKey().default("platform"),
  counselName: text("counsel_name").notNull(),
  barCouncil: text("bar_council").notNull(),
  enrollmentNumber: text("enrollment_number").notNull(),
  counselEmail: text("counsel_email").notNull(),
  supportContactEmail: text("support_contact_email").notNull(),
  privacyContactEmail: text("privacy_contact_email").notNull(),
  privacyContactAddress: text("privacy_contact_address").notNull(),
  grievanceOfficerName: text("grievance_officer_name").notNull(),
  grievanceOfficerEmail: text("grievance_officer_email").notNull(),
  approvedBy: text("approved_by").notNull().references(() => accounts.id),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
