import { eq } from "drizzle-orm";
import { db, platformCompliance } from "@workspace/db";

const PLATFORM_RECORD_ID = "platform";

export async function getLegalReviewApproval() {
  const [approval] = await db.select().from(platformCompliance)
    .where(eq(platformCompliance.id, PLATFORM_RECORD_ID)).limit(1);
  return approval ?? null;
}

export async function hasLegalReviewApproval(): Promise<boolean> {
  return Boolean(await getLegalReviewApproval());
}
