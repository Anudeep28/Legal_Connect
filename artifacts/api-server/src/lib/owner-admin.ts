import { clerkClient } from "@clerk/express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { accounts, auditLogs, db } from "@workspace/db";
import { logger } from "./logger";

type OwnerIdentity = {
  id: string;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[];
  fullName: string | null;
  firstName: string | null;
};
type OwnerDirectory = (email: string) => Promise<OwnerIdentity[]>;
const directory: OwnerDirectory = async (email) =>
  (await clerkClient.users.getUserList({ emailAddress: [email], limit: 2 })).data;

// Runs inside the target environment. Never reuse a Preview Clerk user ID.
// The audit marker prevents later restarts from restoring a revoked grant.
export async function grantOwnerAdmin(rawEmail: string, lookup: OwnerDirectory = directory) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid owner email configuration.");
  const candidates = (await lookup(email)).filter((user) =>
    user.emailAddresses.some((entry) =>
      entry.id === user.primaryEmailAddressId &&
      entry.emailAddress.toLowerCase() === email &&
      entry.verification?.status === "verified"));
  if (candidates.length !== 1)
    throw new Error("Exactly one verified owner must exist in this environment before administrator setup.");
  const user = candidates[0];
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`owner-admin:${email}`}))`);
    const [existing] = await tx.select().from(accounts).where(eq(accounts.id, user.id)).for("update");
    const [previousGrant] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.targetId, user.id), eq(auditLogs.action, "admin:owner-designated"),
    )).limit(1);
    if (previousGrant) return "previously-applied";
    if (existing && (existing.status !== "active" || existing.email.toLowerCase() !== email))
      throw new Error("Owner account status or email requires review.");
    if (existing?.role === "lawyer")
      throw new Error("Use a separate client account for administration.");
    await tx.insert(accounts).values({
      id: user.id, email, name: user.fullName || user.firstName || "Administrator", role: "admin",
    }).onConflictDoUpdate({ target: accounts.id, set: { role: "admin" } });
    await tx.insert(auditLogs).values({
      id: randomUUID(), actorId: user.id, targetId: user.id, action: "admin:owner-designated",
      reason: "Owner-designated administrator resolved by verified primary email in the current authentication environment.",
    });
    return "applied";
  });
}

export async function bootstrapConfiguredOwner() {
  const email = process.env.OWNER_ADMIN_BOOTSTRAP_EMAIL;
  if (!email) return;
  try {
    const result = await grantOwnerAdmin(email);
    logger.info({ result }, "Owner administrator bootstrap checked");
  } catch {
    // Provider exceptions can contain private account data. Fail closed without
    // taking down ordinary sign-in or logging the configured email.
    logger.error("Owner administrator bootstrap failed; check verified owner and target-environment configuration.");
  }
}
