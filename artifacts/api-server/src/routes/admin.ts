import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, accounts, lawyers, consultations, documents, reviews, auditLogs, notifications } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { requireAccount, requireAdmin, HttpError } from "../middlewares/access";
import { lawyerViews } from "../lib/legal";

const router: IRouter = Router();
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
    if (input.status !== "active") await tx.update(lawyers).set({ approvalStatus: "pending", verified: false, online: false }).where(eq(lawyers.ownerId, id));
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
