import { logger } from "./logger";
import { grantOwnerAdmin } from "./owner-admin";

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
  await grantOwnerAdmin(email);
  logger.info("Administrator access configured in the current environment.");
}
main().then(() => process.exit(0)).catch((err: Error) => {
  logger.error({ message: err.message }, "Administrator setup failed"); process.exit(1);
});
