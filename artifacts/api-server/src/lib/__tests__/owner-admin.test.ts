import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { accounts, auditLogs, db, pool } from "@workspace/db";
import { grantOwnerAdmin } from "../owner-admin";

assert.equal(process.env.NODE_ENV, "test");
const ids: string[] = [];
const email = "owner-fixture@example.invalid";
function identity(verified = true) {
  const id = `owner_fixture_${randomUUID()}`;
  ids.push(id);
  return {
    id, primaryEmailAddressId: "primary", fullName: "Owner fixture", firstName: null,
    emailAddresses: [{ id: "primary", emailAddress: email, verification: { status: verified ? "verified" : "unverified" } }],
  };
}
after(async () => {
  if (ids.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.targetId, ids));
    await db.delete(accounts).where(inArray(accounts.id, ids));
  }
  await pool.end();
});

test("owner must have one verified matching primary email in the target identity store", async () => {
  await assert.rejects(grantOwnerAdmin(email, async () => []));
  await assert.rejects(grantOwnerAdmin(email, async () => [identity(false)]));
  const secondary = identity();
  secondary.primaryEmailAddressId = "other";
  await assert.rejects(grantOwnerAdmin(email, async () => [secondary]));
  await assert.rejects(grantOwnerAdmin(email, async () => [identity(), identity()]));
});

test("grant targets the resolved identity, preserves credits and never restores a revoked grant", async () => {
  const owner = identity();
  const old = identity();
  await db.insert(accounts).values([
    { id: old.id, email, name: "Old identity", role: "admin" },
    { id: owner.id, email, name: "Current identity", documentCredits: 7 },
  ]);
  const lookup = async () => [owner];
  const results = await Promise.all([grantOwnerAdmin(email, lookup), grantOwnerAdmin(email, lookup)]);
  assert.deepEqual(results.sort(), ["applied", "previously-applied"]);
  const [updated] = await db.select().from(accounts).where(eq(accounts.id, owner.id));
  assert.equal(updated.role, "admin");
  assert.equal(updated.documentCredits, 7);
  const entries = await db.select().from(auditLogs).where(eq(auditLogs.targetId, owner.id));
  assert.equal(entries.length, 1);
  await db.update(accounts).set({ role: "client" }).where(eq(accounts.id, owner.id));
  assert.equal(await grantOwnerAdmin(email, lookup), "previously-applied");
  const [revoked] = await db.select().from(accounts).where(eq(accounts.id, owner.id));
  assert.equal(revoked.role, "client");
});

test("suspended accounts and lawyer accounts cannot acquire bootstrap admin access", async () => {
  for (const state of [{ status: "suspended" as const, role: "client" as const }, { status: "active" as const, role: "lawyer" as const }]) {
    const owner = identity();
    await db.insert(accounts).values({ id: owner.id, email, name: "Restricted fixture", ...state });
    await assert.rejects(grantOwnerAdmin(email, async () => [owner]));
  }
});
