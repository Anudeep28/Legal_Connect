import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, consultationCheckoutControl, auditLogs } from "@workspace/db";

const CONTROL_ID = "platform";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConsultationCheckoutState = {
  paused: boolean;
  reason: string | null;
  changedAt: string | null;
};

function stateView(record: typeof consultationCheckoutControl.$inferSelect | undefined): ConsultationCheckoutState {
  return {
    paused: record?.paused ?? false,
    reason: record?.reason ?? null,
    changedAt: record?.changedAt ?? null,
  };
}

export async function getConsultationCheckoutState(): Promise<ConsultationCheckoutState> {
  const [record] = await db.select().from(consultationCheckoutControl)
    .where(eq(consultationCheckoutControl.id, CONTROL_ID)).limit(1);
  return stateView(record);
}

export async function lockConsultationCheckoutControl(tx: Tx) {
  await tx.insert(consultationCheckoutControl).values({ id: CONTROL_ID }).onConflictDoNothing();
  const [record] = await tx.select().from(consultationCheckoutControl)
    .where(eq(consultationCheckoutControl.id, CONTROL_ID)).for("update");
  return record!;
}

export async function setConsultationCheckoutPaused(
  actorId: string,
  paused: boolean,
  reason: string,
): Promise<ConsultationCheckoutState> {
  return db.transaction(async (tx) => {
    const current = await lockConsultationCheckoutControl(tx);
    if (current.paused === paused) return stateView(current);
    const changedAt = new Date().toISOString();
    const [updated] = await tx.update(consultationCheckoutControl).set({
      paused,
      reason,
      changedBy: actorId,
      changedAt,
    }).where(eq(consultationCheckoutControl.id, CONTROL_ID)).returning();
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorId,
      targetId: CONTROL_ID,
      action: paused ? "billing:consultation-checkout-paused" : "billing:consultation-checkout-resumed",
      reason: `Paid consultation checkout ${paused ? "paused" : "resumed"}: ${reason}`,
    });
    return stateView(updated);
  });
}

export function consultationCheckoutPausedError(): string {
  return "Paid consultation checkout is temporarily paused. No payment was taken.";
}

export function consultationRequestPausedError(): string {
  return "Paid consultation requests are temporarily unavailable while checkout is paused. No request or payment was created.";
}
