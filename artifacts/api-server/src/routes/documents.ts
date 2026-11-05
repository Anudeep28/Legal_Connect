import { Router, type IRouter } from "express";
import { and, eq, desc, gt, sql, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, documents, accounts, paymentOrders } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { requireAccount, requireLawyer, HttpError } from "../middlewares/access";
import type { Account } from "../middlewares/access";
import { lockAccount } from "../lib/payments";
import { hasDocumentTrial, hasMonthlyAccess } from "../lib/payment-rules";

const router: IRouter = Router();
router.use("/documents", requireAccount, requireLawyer);

export async function insertDocumentWithAccess(account: Account, values: typeof documents.$inferInsert) {
  return db.transaction(async (tx) => {
    const current = await lockAccount(tx, account.id);
    const inTrial = hasDocumentTrial(current.createdAt);
    const monthly = hasMonthlyAccess(current.subscriptionExpiresAt);
    if (!inTrial && monthly) {
      const [grant] = await tx.select().from(paymentOrders).where(and(
        eq(paymentOrders.userId, account.id), eq(paymentOrders.kind, "monthly"),
        eq(paymentOrders.status, "paid"), gt(paymentOrders.entitlementEndsAt, new Date().toISOString()),
      )).orderBy(asc(paymentOrders.entitlementEndsAt)).limit(1).for("update");
      if (!grant) throw new HttpError(402, "Your plan could not be verified. Please check your payment history.");
      await tx.update(paymentOrders).set({ usedCount: sql`${paymentOrders.usedCount} + 1` }).where(eq(paymentOrders.id, grant.id));
    } else if (!inTrial) {
      const [credit] = await tx.update(accounts)
        .set({ documentCredits: sql`${accounts.documentCredits} - 1` })
        .where(and(eq(accounts.id, account.id), gt(accounts.documentCredits, 0))).returning();
      if (!credit) throw new HttpError(402, "Your 2-day trial has ended. A document credit or active 30-day plan is required. Existing documents can still be edited and exported.");
      const [grant] = await tx.select().from(paymentOrders).where(and(
        eq(paymentOrders.userId, account.id), eq(paymentOrders.kind, "single"),
        eq(paymentOrders.status, "paid"), eq(paymentOrders.usedCount, 0),
      )).orderBy(asc(paymentOrders.paidAt)).limit(1).for("update");
      if (grant) await tx.update(paymentOrders).set({ usedCount: 1 }).where(eq(paymentOrders.id, grant.id));
    }
    const [document] = await tx.insert(documents).values(values).returning();
    return document;
  });
}

router.get("/documents", async (req, res): Promise<void> => {
  res.json(api.ListDocumentsResponse.parse(await db.select().from(documents).where(eq(documents.userId, req.account.id)).orderBy(desc(documents.updatedAt))));
});
router.post("/documents", async (req, res): Promise<void> => {
  const input = api.CreateDocumentBody.parse(req.body);
  if (!input.title.trim()) throw new HttpError(400, "Please enter a document title.");
  const document = await insertDocumentWithAccess(req.account, {
    ...input, title: input.title.trim(), id: randomUUID(), userId: req.account.id,
  });
  res.status(201).json(api.CreateDocumentResponse.parse(document));
});
router.get("/documents/:id", async (req, res): Promise<void> => {
  const { id } = api.GetDocumentParams.parse(req.params);
  const [document] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.userId, req.account.id)));
  if (!document) throw new HttpError(404, "Document not found.");
  res.json(api.GetDocumentResponse.parse(document));
});
router.patch("/documents/:id", async (req, res): Promise<void> => {
  const { id } = api.UpdateDocumentParams.parse(req.params);
  const input = api.UpdateDocumentBody.parse(req.body);
  if (!input.title.trim()) throw new HttpError(400, "Please enter a document title.");
  const [document] = await db.update(documents).set({
    ...input, title: input.title.trim(), updatedAt: new Date().toISOString(),
  }).where(and(eq(documents.id, id), eq(documents.userId, req.account.id))).returning();
  if (!document) throw new HttpError(404, "Document not found.");
  res.json(api.UpdateDocumentResponse.parse(document));
});
router.delete("/documents/:id", async (req, res): Promise<void> => {
  const { id } = api.DeleteDocumentParams.parse(req.params);
  const [document] = await db.delete(documents).where(and(eq(documents.id, id), eq(documents.userId, req.account.id))).returning();
  if (!document) throw new HttpError(404, "Document not found.");
  res.sendStatus(204);
});
router.post("/documents/:id/duplicate", async (req, res): Promise<void> => {
  const { id } = api.DuplicateDocumentParams.parse(req.params);
  const [original] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.userId, req.account.id)));
  if (!original) throw new HttpError(404, "Document not found.");
  const document = await insertDocumentWithAccess(req.account, {
    userId: req.account.id, id: randomUUID(),
    title: `${original.title.slice(0, 190)} (copy)`, content: original.content,
    templateId: original.templateId, category: original.category, language: original.language,
  });
  res.status(201).json(api.DuplicateDocumentResponse.parse(document));
});
export default router;
