import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { aiUsageLimits, auditLogs, db } from "@workspace/db";
import { HttpError } from "../middlewares/access";

export type AiPlan = "trial" | "single" | "monthly";
export type AiUsageKind = "drafting" | "transcription";
export type AiPlanLimits = Record<AiPlan, number>;
export type AiUsageLimitValues = Record<AiUsageKind, AiPlanLimits>;
export type AiUsageLimitsState = AiUsageLimitValues & {
  source: "server_settings" | "owner";
  updatedAt: string | null;
};

type Env = Record<string, string | undefined>;
type DbReader = Pick<typeof db, "select">;
const CONFIG_ID = "platform";
const MAX_DAILY_LIMIT = 10_000;

export function aiDailyLimit(kind: AiUsageKind, plan: AiPlan, env: Env = process.env): number {
  const prefix = kind === "drafting" ? "AI_DRAFTING" : "AI_TRANSCRIPTION";
  const planKey = `${prefix}_DAILY_LIMIT_${plan.toUpperCase()}`;
  const legacyKey = `${prefix}_DAILY_LIMIT`;
  // Preserve the prior one-size override for monthly users only.
  const raw = env[planKey] ?? (plan === "monthly" ? env[legacyKey] : undefined);
  if (raw === undefined) return plan === "trial" ? 5 : plan === "single" ? 15 : 30;
  if (!/^\d+$/.test(raw) || Number(raw) > MAX_DAILY_LIMIT) {
    throw new HttpError(503, "AI usage limits are misconfigured. Please contact the administrator.");
  }
  return Number(raw);
}

function serverSettings(env: Env = process.env): AiUsageLimitValues {
  return {
    drafting: {
      trial: aiDailyLimit("drafting", "trial", env),
      single: aiDailyLimit("drafting", "single", env),
      monthly: aiDailyLimit("drafting", "monthly", env),
    },
    transcription: {
      trial: aiDailyLimit("transcription", "trial", env),
      single: aiDailyLimit("transcription", "single", env),
      monthly: aiDailyLimit("transcription", "monthly", env),
    },
  };
}

function valuesFromRow(row: typeof aiUsageLimits.$inferSelect): AiUsageLimitValues {
  return {
    drafting: { trial: row.draftingTrial, single: row.draftingSingle, monthly: row.draftingMonthly },
    transcription: { trial: row.transcriptionTrial, single: row.transcriptionSingle, monthly: row.transcriptionMonthly },
  };
}

export async function getAiUsageLimitsState(
  query: DbReader = db,
  lockForShare = false,
  configId = CONFIG_ID,
): Promise<AiUsageLimitsState> {
  const [row] = lockForShare
    ? await query.select().from(aiUsageLimits).where(eq(aiUsageLimits.id, configId)).for("share").limit(1)
    : await query.select().from(aiUsageLimits).where(eq(aiUsageLimits.id, configId)).limit(1);
  if (!row) return { ...serverSettings(), source: "server_settings", updatedAt: null };
  return {
    ...valuesFromRow(row),
    source: "owner",
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function validateLimits(input: AiUsageLimitValues): void {
  for (const kind of ["drafting", "transcription"] as const) {
    for (const plan of ["trial", "single", "monthly"] as const) {
      const value = input[kind][plan];
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_DAILY_LIMIT) {
        throw new HttpError(400, "Each daily AI limit must be a whole number from 0 to 10,000.");
      }
    }
  }
}

export async function saveAdminAiUsageLimits(
  input: AiUsageLimitValues,
  ownerId: string,
  now = new Date(),
  configId = CONFIG_ID,
): Promise<AiUsageLimitsState> {
  validateLimits(input);
  await db.transaction(async (tx) => {
    await tx.select({ id: aiUsageLimits.id }).from(aiUsageLimits)
      .where(eq(aiUsageLimits.id, configId)).for("update").limit(1);
    const current = await getAiUsageLimitsState(tx, false, configId);
    await tx.insert(aiUsageLimits).values({
      id: configId,
      draftingTrial: input.drafting.trial,
      draftingSingle: input.drafting.single,
      draftingMonthly: input.drafting.monthly,
      transcriptionTrial: input.transcription.trial,
      transcriptionSingle: input.transcription.single,
      transcriptionMonthly: input.transcription.monthly,
      configuredBy: ownerId,
      updatedAt: now.toISOString(),
    }).onConflictDoUpdate({
      target: aiUsageLimits.id,
      set: {
        draftingTrial: input.drafting.trial,
        draftingSingle: input.drafting.single,
        draftingMonthly: input.drafting.monthly,
        transcriptionTrial: input.transcription.trial,
        transcriptionSingle: input.transcription.single,
        transcriptionMonthly: input.transcription.monthly,
        configuredBy: ownerId,
        updatedAt: now.toISOString(),
      },
    });
    const changed = [
      `drafting trial ${current.drafting.trial}→${input.drafting.trial}`,
      `drafting single-credit ${current.drafting.single}→${input.drafting.single}`,
      `drafting monthly ${current.drafting.monthly}→${input.drafting.monthly}`,
      `transcription trial ${current.transcription.trial}→${input.transcription.trial}`,
      `transcription single-credit ${current.transcription.single}→${input.transcription.single}`,
      `transcription monthly ${current.transcription.monthly}→${input.transcription.monthly}`,
    ];
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorId: ownerId,
      targetId: configId,
      action: "admin:ai-usage-limits-updated",
      reason: `Daily AI limits saved: ${changed.join(", ")}.`,
    });
  });
  return getAiUsageLimitsState(db, false, configId);
}

export { serverSettings as getServerAiUsageLimitDefaults };
