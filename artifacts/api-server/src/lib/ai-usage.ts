import { and, eq, lt, sql } from "drizzle-orm";
import { db, aiUsage } from "@workspace/db";
import { HttpError } from "../middlewares/access";

type Kind = "drafting" | "transcription";
type Env = Record<string, string | undefined>;

export function aiDailyLimit(kind: Kind, env: Env = process.env): number {
  const key = kind === "drafting" ? "AI_DRAFTING_DAILY_LIMIT" : "AI_TRANSCRIPTION_DAILY_LIMIT";
  const raw = env[key];
  if (raw === undefined) return 30;
  if (!/^\d+$/.test(raw) || Number(raw) > 10000) {
    throw new HttpError(503, "AI usage limits are misconfigured. Please contact the administrator.");
  }
  return Number(raw);
}

export function aiUsageWindow(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const resetsAt = new Date(`${day}T00:00:00.000Z`);
  resetsAt.setUTCDate(resetsAt.getUTCDate() + 1);
  return { day, resetsAt: resetsAt.toISOString() };
}

export async function getAiUsage(accountId: string, now = new Date()) {
  const { day, resetsAt } = aiUsageWindow(now);
  const rows = await db.select().from(aiUsage).where(and(eq(aiUsage.accountId, accountId), eq(aiUsage.day, day)));
  const allowance = (kind: Kind) => {
    const limit = aiDailyLimit(kind);
    const used = rows.find(row => row.kind === kind)?.used ?? 0;
    return { limit, used, remaining: Math.max(0, limit - used) };
  };
  return { drafting: allowance("drafting"), transcription: allowance("transcription"), resetsAt };
}

// Atomic insert-or-increment: multiple processes share the same strict allowance.
// Charge immediately before provider invocation, never refund uncertain failures:
// a timeout can still have incurred provider charges.
export async function reserveAiAttempt(accountId: string, kind: Kind, now = new Date()) {
  const { day, resetsAt } = aiUsageWindow(now);
  const limit = aiDailyLimit(kind);
  const exhausted = () => new HttpError(429,
    `Your daily ${kind} limit (${limit} requests) has been reached. It resets at ${resetsAt} (midnight UTC). Your document has not been changed.`);
  if (!limit) throw exhausted();
  const [reserved] = await db.insert(aiUsage).values({ accountId, kind, day, used: 1 })
    .onConflictDoUpdate({
      target: [aiUsage.accountId, aiUsage.kind, aiUsage.day],
      set: { used: sql`${aiUsage.used} + 1` },
      setWhere: lt(aiUsage.used, limit),
    }).returning({ used: aiUsage.used });
  if (!reserved) throw exhausted();
  return { used: reserved.used, limit, resetsAt };
}
