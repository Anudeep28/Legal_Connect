import { clerkClient } from "@clerk/express";
import { db, accounts, auditLogs } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";

/**
 * Run only with an owner-designated, verified account:
 * pnpm --filter @workspace/api-server run grant-admin -- email@example.com
 * Uses the CURRENT environment's Clerk instance and database.
 * Never grants the first visitor privileges or accepts an HTTP role override.
 */
async function main() {
  const email = process.argv.slice(2).find((a) => a.includes("@"))?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Pass the platform owner's administrator email.");
  const users = await clerkClient.users.getUserList({ emailAddress: [email], limit: 2 });
  const user = users.data.find((u) => u.emailAddresses.some((e) =>
    e.emailAddress.toLowerCase() === email && e.verification?.status === "verified"));
  if (!user) throw new Error("The designated administrator must sign up and verify this email in the target environment first.");
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(accounts).where(eq(accounts.id, user.id));
    if (existing && existing.status !== "active") throw new Error("This account is not active. Resolve its account status before granting privileges.");
    if (existing?.role === "admin") return;
    if (existing?.role === "lawyer") throw new Error("Use a separate client account for administration, not an active lawyer account.");
    await tx.insert(accounts).values({
      id: user.id, email, name: user.fullName || user.firstName || "Administrator", role: "admin",
    }).onConflictDoUpdate({ target: accounts.id, set: { role: "admin" } });
    await tx.insert(auditLogs).values({
      id: randomUUID(), actorId: user.id, targetId: user.id,
      action: "admin:owner-designated", reason: "Administrator explicitly designated by the platform owner through the local administration command.",
    });
  });
  logger.info("Administrator access configured in the current environment.");
}
main().then(() => process.exit(0)).catch((err: Error) => {
  logger.error({ message: err.message }, "Administrator setup failed"); process.exit(1);
});
