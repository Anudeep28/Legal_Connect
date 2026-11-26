import { Router, type IRouter, type RequestHandler } from "express";
import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, accounts, lawyers, consultations, documents, reviews, auditLogs, notifications, platformCompliance } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { requireAccount, requireAdmin, requireOwnerAdmin, requireOwnerSystemStatus, canManageGrievances, isOwnerDesignatedAdmin, HttpError } from "../middlewares/access";
import { lawyerViews } from "../lib/legal";
import { paymentsEnabled } from "../lib/razorpay";
import { getLegalReviewApproval } from "../lib/legal-review";
import { getConsultationCheckoutState, setConsultationCheckoutPaused } from "../lib/consultation-checkout";
import { getTwilioUsageBudgetState, getTwilioUsageHistory, refreshTwilioUsageBudget, saveTwilioUsageBudgetConfig } from "../lib/twilio-usage-budget";
import { getAdminAiUsage } from "../lib/ai-usage";
import { saveAdminAiUsageBudgetConfig } from "../lib/ai-usage-budget";
import { saveAdminAiUsageLimits } from "../lib/ai-usage-limits";
import { getDatabaseOutageStatus } from "../lib/database-outage-monitor";

const router: IRouter = Router();
const checkoutHistoryActions = [
  "billing:consultation-checkout-paused",
  "billing:consultation-checkout-resumed",
] as const;

export function createAdminConsultationCheckoutHistoryRouter(
  authMiddlewares: RequestHandler[] = [requireAccount, requireAdmin],
): IRouter {
  const historyRouter: IRouter = Router();
  historyRouter.use("/admin/consultation-checkout-history", ...authMiddlewares, requireOwnerAdmin);
  historyRouter.get("/admin/consultation-checkout-history", async (_req, res): Promise<void> => {
    const rows = await db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      reason: auditLogs.reason,
      changedAt: auditLogs.createdAt,
      actorName: accounts.name,
      actorEmail: accounts.email,
    }).from(auditLogs)
      .innerJoin(accounts, eq(auditLogs.actorId, accounts.id))
      .where(and(
        eq(auditLogs.targetId, "platform"),
        inArray(auditLogs.action, [...checkoutHistoryActions]),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);
    res.set("Cache-Control", "no-store").json(api.GetAdminConsultationCheckoutHistoryResponse.parse({
      events: rows.map((row) => {
        const action = row.action === "billing:consultation-checkout-paused" ? "paused" : "resumed";
        const reasonPrefix = `Paid consultation checkout ${action}:`;
        return {
          id: row.id,
          action,
          reason: row.reason.startsWith(reasonPrefix) ? row.reason.slice(reasonPrefix.length).trim() : row.reason,
          changedAt: row.changedAt,
          actorName: row.actorName,
          actorEmail: row.actorEmail,
        };
      }),
    }));
  });
  return historyRouter;
}

router.use(createAdminConsultationCheckoutHistoryRouter());
router.get("/admin/system-status", requireOwnerSystemStatus, (_req, res): void => {
  res.set("Cache-Control", "no-store").json(api.GetAdminSystemStatusResponse.parse({
    api: "live",
    ...getDatabaseOutageStatus(),
  }));
});
router.use("/admin", requireAccount, requireAdmin);
router.get("/admin/overview", async (_req, res): Promise<void> => {
  const [u, l, c, d] = await Promise.all([
    db.select({ count: sql<number>`count(*)::integer` }).from(accounts),
    db.select({ count: sql<number>`count(*)::integer`, pending: sql<number>`count(*) filter (where ${lawyers.approvalStatus} = 'pending')::integer` }).from(lawyers),
    db.select({ count: sql<number>`count(*)::integer`, completed: sql<number>`count(*) filter (where ${consultations.status} = 'completed')::integer` }).from(consultations),
    db.select({ count: sql<number>`count(*)::integer` }).from(documents),
  ]);
  res.json(api.GetAdminOverviewResponse.parse({
    users: u[0]!.count, lawyers: l[0]!.count, pendingLawyers: l[0]!.pending,
    consultations: c[0]!.count, completedConsultations: c[0]!.completed, documents: d[0]!.count,
  }));
});
router.get("/admin/ai-usage", requireOwnerAdmin, async (req, res): Promise<void> => {
  const { days } = api.GetAdminAiUsageQueryParams.parse(req.query);
  const report = await getAdminAiUsage(days);
  res.set("Cache-Control", "no-store").json(api.GetAdminAiUsageResponse.parse(report));
});
router.put("/admin/ai-usage-budget", requireOwnerAdmin, async (req, res): Promise<void> => {
  const input = api.UpdateAdminAiUsageBudgetBody.parse(req.body);
  const state = await saveAdminAiUsageBudgetConfig(input, req.account.id);
  res.set("Cache-Control", "no-store").json(api.UpdateAdminAiUsageBudgetResponse.parse(state));
});
router.put("/admin/ai-usage-limits", requireOwnerAdmin, async (req, res): Promise<void> => {
  const input = api.UpdateAdminAiUsageLimitsBody.parse(req.body);
  const state = await saveAdminAiUsageLimits(input, req.account.id);
  res.set("Cache-Control", "no-store").json(api.UpdateAdminAiUsageLimitsResponse.parse(state));
});
router.get("/admin/legal-review", async (req, res): Promise<void> => {
  const [approval, canRecord, canReviewGrievances, consultationCheckout] = await Promise.all([
    getLegalReviewApproval(),
    isOwnerDesignatedAdmin(req.account.id),
    canManageGrievances(req.account.id),
    getConsultationCheckoutState(),
  ]);
  res.json(api.GetAdminLegalReviewResponse.parse({
    canRecord,
    canManageGrievances: canReviewGrievances,
    paymentVerificationComplete: paymentsEnabled(),
    paidConsultationsEnabled: paymentsEnabled() && Boolean(approval) && !consultationCheckout.paused,
    consultationCheckout,
    approval: approval ? {
      counselName: approval.counselName,
      barCouncil: approval.barCouncil,
      enrollmentNumber: approval.enrollmentNumber,
      counselEmail: approval.counselEmail,
      supportContactEmail: approval.supportContactEmail,
      privacyContactEmail: approval.privacyContactEmail,
      privacyContactAddress: approval.privacyContactAddress,
      grievanceOfficerName: approval.grievanceOfficerName,
      grievanceOfficerEmail: approval.grievanceOfficerEmail,
      approvedAt: approval.approvedAt,
    } : null,
  }));
});
router.put("/admin/legal-review", requireOwnerAdmin, async (req, res): Promise<void> => {
  const input = api.RecordAdminLegalReviewBody.parse(req.body);
  if (!input.confirmApproval) throw new HttpError(400, "Confirm qualified counsel approval before recording it.");
  const clean = {
    counselName: input.counselName.trim(),
    barCouncil: input.barCouncil.trim(),
    enrollmentNumber: input.enrollmentNumber.trim(),
    counselEmail: input.counselEmail.trim().toLowerCase(),
    supportContactEmail: input.supportContactEmail.trim().toLowerCase(),
    privacyContactEmail: input.privacyContactEmail.trim().toLowerCase(),
    privacyContactAddress: input.privacyContactAddress.trim(),
    grievanceOfficerName: input.grievanceOfficerName.trim(),
    grievanceOfficerEmail: input.grievanceOfficerEmail.trim().toLowerCase(),
    approvedBy: req.account.id,
    approvedAt: new Date().toISOString(),
  };
  if ([clean.counselName, clean.barCouncil, clean.enrollmentNumber, clean.privacyContactAddress, clean.grievanceOfficerName].some((value) => !value))
    throw new HttpError(400, "Complete every counsel and policy contact field.");
  const approval = await db.transaction(async (tx) => {
    const [record] = await tx.insert(platformCompliance).values({
      id: "platform",
      ...clean,
    }).onConflictDoUpdate({
      target: platformCompliance.id,
      set: clean,
    }).returning();
    await tx.insert(auditLogs).values({
      id: randomUUID(),
      actorId: req.account.id,
      targetId: "platform",
      action: "legal:counsel-approval-recorded",
      reason: `Qualified counsel approval recorded for ${clean.counselName}; policy contacts and address updated.`,
    });
    return record!;
  });
  const consultationCheckout = await getConsultationCheckoutState();
  res.json(api.RecordAdminLegalReviewResponse.parse({
    canRecord: true,
    canManageGrievances: await canManageGrievances(req.account.id),
    paymentVerificationComplete: paymentsEnabled(),
    paidConsultationsEnabled: paymentsEnabled() && !consultationCheckout.paused,
    consultationCheckout,
    approval: {
      counselName: approval.counselName,
      barCouncil: approval.barCouncil,
      enrollmentNumber: approval.enrollmentNumber,
      counselEmail: approval.counselEmail,
      supportContactEmail: approval.supportContactEmail,
      privacyContactEmail: approval.privacyContactEmail,
      privacyContactAddress: approval.privacyContactAddress,
      grievanceOfficerName: approval.grievanceOfficerName,
      grievanceOfficerEmail: approval.grievanceOfficerEmail,
      approvedAt: approval.approvedAt,
    },
  }));
});
router.put("/admin/consultation-checkout", requireOwnerAdmin, async (req, res): Promise<void> => {
  const input = api.UpdateAdminConsultationCheckoutBody.parse(req.body);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new HttpError(400, "Enter a brief operational reason for this checkout change.");
  const state = await setConsultationCheckoutPaused(req.account.id, input.paused, reason);
  res.json(api.UpdateAdminConsultationCheckoutResponse.parse(state));
});
router.get("/admin/twilio-usage-budget", requireOwnerAdmin, async (_req, res): Promise<void> => {
  const state = await getTwilioUsageBudgetState();
  res.set("Cache-Control", "no-store").json(api.GetAdminTwilioUsageBudgetResponse.parse(state));
});
router.put("/admin/twilio-usage-budget", requireOwnerAdmin, async (req, res): Promise<void> => {
  const input = api.UpdateAdminTwilioUsageBudgetBody.parse(req.body);
  if (input.enabled && (input.budgetAmount === null || input.budgetAmount <= 0))
    throw new HttpError(400, "Enter a positive monthly budget before enabling alerts.");
  const state = await saveTwilioUsageBudgetConfig(input, req.account.id);
  res.set("Cache-Control", "no-store").json(api.UpdateAdminTwilioUsageBudgetResponse.parse(state));
});
router.post("/admin/twilio-usage-budget/refresh", requireOwnerAdmin, async (req, res): Promise<void> => {
  const state = await refreshTwilioUsageBudget({ force: true, ownerId: req.account.id });
  res.set("Cache-Control", "no-store").json(api.RefreshAdminTwilioUsageBudgetResponse.parse(state));
});
router.get("/admin/twilio-usage-history", requireOwnerAdmin, async (_req, res): Promise<void> => {
  const history = await getTwilioUsageHistory();
  res.set("Cache-Control", "no-store").json(api.GetAdminTwilioUsageHistoryResponse.parse(history));
});
router.get("/admin/users", async (_req, res): Promise<void> => {
  res.json(api.ListAdminUsersResponse.parse(await db.select().from(accounts).orderBy(desc(accounts.createdAt))));
});
router.get("/admin/lawyers", async (_req, res): Promise<void> => {
  res.json(api.ListAdminLawyersResponse.parse(await lawyerViews(await db.select().from(lawyers))));
});
router.get("/admin/reviews", async (_req, res): Promise<void> => {
  res.json(api.ListAdminReviewsResponse.parse(await db.select().from(reviews).orderBy(desc(reviews.createdAt))));
});
router.patch("/admin/users/:id", async (req, res): Promise<void> => {
  const { id } = api.ModerateUserParams.parse(req.params);
  const input = api.ModerateUserBody.parse(req.body);
  if (!input.reason.trim()) throw new HttpError(400, "Please provide a moderation reason.");
  const [target] = await db.select().from(accounts).where(eq(accounts.id, id));
  if (!target) throw new HttpError(404, "Account not found.");
  if (target.role === "admin") throw new HttpError(403, "Administrator accounts cannot be suspended through this interface.");
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(accounts).set({ status: input.status }).where(eq(accounts.id, id)).returning();
    await tx.insert(auditLogs).values({ id: randomUUID(), actorId: req.account.id, targetId: id, action: `account:${input.status}`, reason: input.reason.trim() });
    // A suspended lawyer must stop appearing publicly and receiving requests.
    if (input.status !== "active") await tx.update(lawyers).set({
      approvalStatus: "pending",
      verified: false,
      presenceStatus: "offline",
      online: false,
      presenceChangedAt: sql`CASE WHEN ${lawyers.presenceStatus} <> 'offline' THEN NOW() ELSE ${lawyers.presenceChangedAt} END`,
    }).where(eq(lawyers.ownerId, id));
    return updated;
  });
  res.json(api.ModerateUserResponse.parse(result));
});
router.patch("/admin/lawyers/:id", async (req, res): Promise<void> => {
  const { id } = api.ModerateLawyerParams.parse(req.params);
  const input = api.ModerateLawyerBody.parse(req.body);
  if (!input.reason.trim()) throw new HttpError(400, "Please provide a moderation reason.");
  const [lawyer] = await db.select().from(lawyers).where(eq(lawyers.id, id));
  if (!lawyer) throw new HttpError(404, "Lawyer profile not found.");
  if (lawyer.demo) throw new HttpError(400, "Illustrative profiles cannot be verified as real lawyers.");
  if (lawyer.ownerId) {
    const [owner] = await db.select().from(accounts).where(eq(accounts.id, lawyer.ownerId));
    if (!owner || owner.status !== "active") throw new HttpError(409, "Reactivate this lawyer's account before approving their profile.");
  }
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx.update(lawyers).set({
      approvalStatus: input.approvalStatus, verified: input.approvalStatus === "approved",
      rejectionReason: input.approvalStatus === "rejected" ? input.reason.trim() : "",
    }).where(eq(lawyers.id, id)).returning();
    await tx.insert(auditLogs).values({ id: randomUUID(), actorId: req.account.id, targetId: id, action: `lawyer:${input.approvalStatus}`, reason: input.reason.trim() });
    if (lawyer.ownerId) await tx.insert(notifications).values({
      id: randomUUID(), userId: lawyer.ownerId, title: `Professional profile ${input.approvalStatus}`,
      body: input.reason.trim(), link: "/lawyer/profile",
    });
    return result!;
  });
  res.json(api.ModerateLawyerResponse.parse((await lawyerViews([updated]))[0]));
});
router.patch("/admin/reviews/:id", async (req, res): Promise<void> => {
  const { id } = api.ModerateReviewParams.parse(req.params);
  const input = api.ModerateReviewBody.parse(req.body);
  if (!input.reason.trim()) throw new HttpError(400, "Please provide a moderation reason.");
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx.update(reviews).set({ visible: input.visible, moderationReason: input.reason.trim() }).where(eq(reviews.id, id)).returning();
    if (!updated) throw new HttpError(404, "Review not found.");
    await tx.insert(auditLogs).values({ id: randomUUID(), actorId: req.account.id, targetId: id, action: input.visible ? "review:restore" : "review:hide", reason: input.reason.trim() });
    return updated;
  });
  res.json(api.ModerateReviewResponse.parse(result));
});
export default router;
