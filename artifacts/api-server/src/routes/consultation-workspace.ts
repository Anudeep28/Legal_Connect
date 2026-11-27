import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, consultations, consultationAttachments, consultationActionPlans, type ActionPlanStep } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { requireAccount, HttpError, type Account } from "../middlewares/access";
import { accessibleConsultation, notify } from "../lib/legal";
import { knownTemplateIds, normalizeBrief, normalizeSteps, planView } from "../lib/action-plan";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type Storage = Pick<ObjectStorageService, "getObjectEntityUploadURL" | "normalizeObjectEntityPath" | "getObjectEntityFile">;

function attachmentView(row: typeof consultationAttachments.$inferSelect, clientId: string) {
  return {
    id: row.id,
    consultationId: row.consultationId,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    uploadedBy: row.uploaderId === clientId ? "client" as const : "lawyer" as const,
    createdAt: row.createdAt,
    downloadPath: `consultations/${row.consultationId}/attachments/${row.id}/file`,
  };
}

async function participantConsultation(account: Account, id: string) {
  const record = await accessibleConsultation(account, id);
  const isClient = record.userId === account.id;
  const isLawyer = record.lawyerOwnerId === account.id;
  if (!isClient && !isLawyer) throw new HttpError(403, "Only the client and assigned lawyer can open this case file.");
  return { record, isClient, isLawyer };
}

export function createConsultationWorkspaceRouter(dependencies: { authMiddlewares?: RequestHandler[]; storage?: Storage } = {}) {
  const router: IRouter = Router();
  const storage: Storage = dependencies.storage ?? new ObjectStorageService();
  // Applied per route so other routers' /consultations paths are not affected.
  const auth = dependencies.authMiddlewares ?? [requireAccount];

  // ----- Pre-call brief -----
  router.put("/consultations/:id/brief", ...auth, async (req, res): Promise<void> => {
    const { id } = api.UpdateConsultationBriefParams.parse(req.params);
    const input = api.UpdateConsultationBriefBody.parse(req.body);
    const record = await accessibleConsultation(req.account, id);
    if (record.userId !== req.account.id) throw new HttpError(403, "Only the client can edit the case brief.");
    if (!["requested", "booked"].includes(record.status)) throw new HttpError(409, "This consultation is closed. The brief is read-only.");
    const brief = normalizeBrief(input);
    if (!brief?.whatHappened) throw new HttpError(400, "Please describe what happened.");
    await db.update(consultations).set({ brief }).where(eq(consultations.id, id));
    if (record.lawyerOwnerId) await notify(record.lawyerOwnerId, "Case brief updated",
      `${req.account.name} updated the brief for “${record.topic}”.`, `/consultations/${id}`);
    res.json(api.UpdateConsultationBriefResponse.parse(await accessibleConsultation(req.account, id)));
  });

  // ----- Attachments -----
  router.get("/consultations/:id/attachments", ...auth, async (req, res): Promise<void> => {
    const { id } = api.ListConsultationAttachmentsParams.parse(req.params);
    const { record } = await participantConsultation(req.account, id);
    const rows = await db.select().from(consultationAttachments)
      .where(and(eq(consultationAttachments.consultationId, id), eq(consultationAttachments.status, "ready")))
      .orderBy(asc(consultationAttachments.createdAt));
    res.set("Cache-Control", "no-store").json(api.ListConsultationAttachmentsResponse.parse(rows.map((r) => attachmentView(r, record.userId))));
  });

  router.post("/consultations/:id/attachments", ...auth, async (req, res): Promise<void> => {
    const { id } = api.RequestConsultationAttachmentUploadParams.parse(req.params);
    const input = api.RequestConsultationAttachmentUploadBody.parse(req.body);
    const { record, isClient } = await participantConsultation(req.account, id);
    if (!isClient) throw new HttpError(403, "Only the client can attach files to the brief.");
    if (!["requested", "booked"].includes(record.status)) throw new HttpError(409, "This consultation is closed. Attachments are read-only.");
    const [{ count }] = await db.select({ count: sql<number>`count(*)::integer` }).from(consultationAttachments)
      .where(eq(consultationAttachments.consultationId, id));
    if (count >= MAX_ATTACHMENTS) throw new HttpError(409, `You can attach up to ${MAX_ATTACHMENTS} files. Remove one to add another.`);
    let uploadURL: string;
    try {
      uploadURL = await storage.getObjectEntityUploadURL(input.contentType);
    } catch (err) {
      req.log.warn({ name: err instanceof Error ? err.name : "UnknownError" }, "Attachment upload URL could not be created");
      throw new HttpError(503, "File uploads are temporarily unavailable. Please try again.");
    }
    const attachmentId = randomUUID();
    await db.insert(consultationAttachments).values({
      id: attachmentId, consultationId: id, uploaderId: req.account.id,
      objectPath: storage.normalizeObjectEntityPath(uploadURL.split("?")[0]),
      name: input.name.trim().replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "attachment",
      contentType: input.contentType, size: input.size, status: "pending",
    });
    res.status(201).json(api.RequestConsultationAttachmentUploadResponse.parse({ attachmentId, uploadURL }));
  });

  router.post("/consultations/:id/attachments/:attachmentId/confirm", ...auth, async (req, res): Promise<void> => {
    const { id, attachmentId } = api.ConfirmConsultationAttachmentParams.parse(req.params);
    const { record } = await participantConsultation(req.account, id);
    const [row] = await db.select().from(consultationAttachments).where(and(
      eq(consultationAttachments.id, attachmentId), eq(consultationAttachments.consultationId, id),
      eq(consultationAttachments.uploaderId, req.account.id),
    ));
    if (!row) throw new HttpError(404, "Attachment not found.");
    if (row.status === "pending") {
      let size = 0;
      let contentType = "";
      try {
        const file = await storage.getObjectEntityFile(row.objectPath);
        const [metadata] = await file.getMetadata();
        size = Number(metadata.size ?? 0);
        contentType = String(metadata.contentType ?? "");
      } catch (err) {
        if (err instanceof ObjectNotFoundError) throw new HttpError(409, "The file upload did not finish. Please try again.");
        throw err;
      }
      if (!size || size > MAX_ATTACHMENT_BYTES || contentType !== row.contentType) {
        await db.delete(consultationAttachments).where(eq(consultationAttachments.id, row.id));
        try { await (await storage.getObjectEntityFile(row.objectPath)).delete(); } catch { /* best effort */ }
        throw new HttpError(400, "The uploaded file did not match the allowed type or size (10 MB).");
      }
      await db.update(consultationAttachments).set({ status: "ready", size }).where(eq(consultationAttachments.id, row.id));
      if (record.lawyerOwnerId) await notify(record.lawyerOwnerId, "New file on a case brief",
        `${req.account.name} attached a file for “${record.topic}”.`, `/consultations/${id}`);
    }
    const [ready] = await db.select().from(consultationAttachments).where(eq(consultationAttachments.id, row.id));
    res.json(api.ConfirmConsultationAttachmentResponse.parse(attachmentView(ready, record.userId)));
  });

  router.delete("/consultations/:id/attachments/:attachmentId", ...auth, async (req, res): Promise<void> => {
    const { id, attachmentId } = api.DeleteConsultationAttachmentParams.parse(req.params);
    const { record } = await participantConsultation(req.account, id);
    if (!["requested", "booked"].includes(record.status)) throw new HttpError(409, "This consultation is closed. Attachments are read-only.");
    const [row] = await db.delete(consultationAttachments).where(and(
      eq(consultationAttachments.id, attachmentId), eq(consultationAttachments.consultationId, id),
      eq(consultationAttachments.uploaderId, req.account.id),
    )).returning();
    if (!row) throw new HttpError(404, "Attachment not found.");
    try {
      await (await storage.getObjectEntityFile(row.objectPath)).delete();
    } catch (err) {
      if (!(err instanceof ObjectNotFoundError)) req.log.warn({ name: err instanceof Error ? err.name : "UnknownError" }, "Attachment object deletion failed");
    }
    res.sendStatus(204);
  });

  router.get("/consultations/:id/attachments/:attachmentId/file", ...auth, async (req, res): Promise<void> => {
    const { id, attachmentId } = api.ConfirmConsultationAttachmentParams.parse(req.params);
    await participantConsultation(req.account, id);
    const [row] = await db.select().from(consultationAttachments).where(and(
      eq(consultationAttachments.id, attachmentId), eq(consultationAttachments.consultationId, id),
      eq(consultationAttachments.status, "ready"),
    ));
    if (!row) throw new HttpError(404, "Attachment not found.");
    let file;
    try {
      file = await storage.getObjectEntityFile(row.objectPath);
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw new HttpError(404, "This file is no longer available.");
      throw err;
    }
    const inline = ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(row.contentType);
    res.set({
      "Content-Type": row.contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    const stream = file.createReadStream();
    stream.on("error", (err) => {
      req.log.warn({ name: err.name }, "Attachment stream failed");
      res.destroy();
    });
    stream.pipe(res);
  });

  // ----- Action plan -----
  router.get("/consultations/:id/action-plan", ...auth, async (req, res): Promise<void> => {
    const { id } = api.GetActionPlanParams.parse(req.params);
    const { isLawyer } = await participantConsultation(req.account, id);
    const [row] = await db.select().from(consultationActionPlans).where(eq(consultationActionPlans.consultationId, id));
    const visible = row && (isLawyer || row.status === "published") ? planView(row) : null;
    res.set("Cache-Control", "no-store").json(api.GetActionPlanResponse.parse(visible));
  });

  router.put("/consultations/:id/action-plan", ...auth, async (req, res): Promise<void> => {
    const { id } = api.SaveActionPlanParams.parse(req.params);
    const input = api.SaveActionPlanBody.parse(req.body);
    const { record, isLawyer } = await participantConsultation(req.account, id);
    if (!isLawyer) throw new HttpError(403, "Only the assigned lawyer can prepare the action plan.");
    if (!["booked", "completed"].includes(record.status)) throw new HttpError(409, "Accept this consultation before preparing an action plan.");
    const publishing = input.status === "published";
    if (publishing && !input.reviewConfirmed)
      throw new HttpError(409, "Confirm that you reviewed the plan before sending it to the client.");
    let wasPublished = false;
    const saved = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(consultationActionPlans)
        .where(eq(consultationActionPlans.consultationId, id)).for("update");
      wasPublished = current?.status === "published";
      if (wasPublished && !publishing) throw new HttpError(409, "A sent plan cannot be hidden from the client. Save your changes and send an update instead.");
      const steps = normalizeSteps(input.steps, current?.steps ?? []);
      const summary = input.summary.trim();
      if (publishing && (!summary || steps.length === 0)) throw new HttpError(400, "Add a summary and at least one next step before sending.");
      const now = new Date().toISOString();
      const values = {
        summary, steps,
        documentsNeeded: input.documentsNeeded.map((d) => d.trim()).filter(Boolean),
        templateIds: knownTemplateIds(input.templateIds),
        status: input.status,
        aiAssisted: (current?.aiAssisted ?? false) || input.aiAssisted,
        lawyerReviewedAt: publishing ? now : current?.lawyerReviewedAt ?? null,
        publishedAt: publishing ? current?.publishedAt ?? now : null,
        updatedAt: now,
      };
      if (current) {
        const [row] = await tx.update(consultationActionPlans).set(values).where(eq(consultationActionPlans.id, current.id)).returning();
        return row;
      }
      const [row] = await tx.insert(consultationActionPlans).values({ id: randomUUID(), consultationId: id, ...values }).returning();
      return row;
    });
    if (publishing) await notify(record.userId, wasPublished ? "Your action plan was updated" : "Your action plan is ready",
      `${req.account.name} sent the next steps for “${record.topic}”.`, `/consultations/${id}`);
    res.json(api.SaveActionPlanResponse.parse(planView(saved)));
  });

  router.patch("/consultations/:id/action-plan/steps/:stepId", ...auth, async (req, res): Promise<void> => {
    const { id, stepId } = api.UpdateActionPlanStepParams.parse(req.params);
    const input = api.UpdateActionPlanStepBody.parse(req.body);
    const { isClient } = await participantConsultation(req.account, id);
    const saved = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(consultationActionPlans)
        .where(eq(consultationActionPlans.consultationId, id)).for("update");
      if (!current || current.status !== "published") throw new HttpError(404, "Action plan not found.");
      const step = current.steps.find((s) => s.id === stepId);
      if (!step) throw new HttpError(404, "Step not found.");
      if (isClient && step.owner !== "client") throw new HttpError(403, "Only your lawyer can update this step.");
      const steps: ActionPlanStep[] = current.steps.map((s) => (s.id === stepId ? { ...s, done: input.done } : s));
      const [row] = await tx.update(consultationActionPlans).set({ steps, updatedAt: new Date().toISOString() })
        .where(eq(consultationActionPlans.id, current.id)).returning();
      return row;
    });
    res.json(api.UpdateActionPlanStepResponse.parse(planView(saved)));
  });

  return router;
}

export default createConsultationWorkspaceRouter();
