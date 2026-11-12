import { Router, type IRouter } from "express";
import { and, eq, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { callsEnabled } from "../lib/communication-config";
import { db, lawyers, consultations, messages, deliverables, reviews, notifications } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { requireAccount, HttpError } from "../middlewares/access";
import { accessibleConsultation, consultationRows, availableSlots, notify } from "../lib/legal";
import { lockAccount } from "../lib/payments";

const router: IRouter = Router();
router.use(["/consultations", "/deliverables"], requireAccount);

router.get("/consultations", async (req, res): Promise<void> => {
  res.json(api.ListConsultationsResponse.parse(await consultationRows(req.account)));
});

router.post("/consultations", async (req, res): Promise<void> => {
  const input = api.CreateConsultationBody.parse(req.body);
  if (req.account.role === "admin") throw new HttpError(403, "Use a client account to request consultations.");
  if (!input.topic.trim() || input.topic.trim().length < 3) throw new HttpError(400, "Please describe the legal issue.");
  if (input.mode === "call" && !callsEnabled()) throw new HttpError(503, "Twilio calling is not configured. Please choose chat.");
  const [lawyer] = await db.select().from(lawyers).where(and(eq(lawyers.id, input.lawyerId), eq(lawyers.approvalStatus, "approved")));
  if (!lawyer) throw new HttpError(404, "Lawyer profile not found.");
  if (lawyer.ownerId === req.account.id) throw new HttpError(400, "You cannot book your own profile.");
  const start = input.startsAt;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
  const slots = await availableSlots(lawyer, date);
  if (!slots.includes(start.toISOString())) throw new HttpError(409, "The selected time is not available. Please choose another slot.");
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(consultations).values({
      id, userId: req.account.id, lawyerId: lawyer.id,
      topic: input.topic.trim(), notes: input.notes?.trim() ?? "",
      startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 30 * 60000).toISOString(),
      mode: input.mode, package: input.package, demo: lawyer.demo,
      fee: Math.round(lawyer.fee * (input.package === "consultation_document" ? 1 + lawyer.documentFeePercent / 100 : 1)),
      status: "requested",
    });
    await tx.insert(notifications).values({
      id: randomUUID(), userId: req.account.id, title: lawyer.demo ? "Demo consultation request saved" : "Consultation request saved",
      body: lawyer.demo ? "This is an illustrative lawyer profile with no practitioner attached. No advice, appointment or payment has been confirmed." : "Your unpaid request has been saved. Verified payment and lawyer acceptance are required before this is a paid, confirmed appointment.",
      link: `/consultations/${id}`,
    });
    if (lawyer.ownerId) await tx.insert(notifications).values({
      id: randomUUID(), userId: lawyer.ownerId, title: "New consultation request",
      body: `${req.account.name} requested a consultation about ${input.topic.trim()}. No payment has been collected.`,
      link: `/consultations/${id}`,
    });
  });
  res.status(201).json(api.CreateConsultationResponse.parse(await accessibleConsultation(req.account, id)));
});

router.get("/consultations/:id", async (req, res): Promise<void> => {
  const { id } = api.GetConsultationParams.parse(req.params);
  res.json(api.GetConsultationResponse.parse(await accessibleConsultation(req.account, id)));
});

router.patch("/consultations/:id", async (req, res): Promise<void> => {
  const { id } = api.UpdateConsultationParams.parse(req.params);
  const input = api.UpdateConsultationBody.parse(req.body);
  const record = await accessibleConsultation(req.account, id);
  const isLawyer = record.lawyerOwnerId === req.account.id;
  if (!input.status && input.transcript === undefined) throw new HttpError(400, "No update was supplied.");
  if (input.transcript !== undefined && !isLawyer) throw new HttpError(403, "Only the assigned lawyer can edit the transcript.");
  await db.transaction(async (tx) => {
    await lockAccount(tx, record.userId);
    const [current] = await tx.select().from(consultations).where(eq(consultations.id, id)).for("update");
    if (input.status) {
    const allowed = (
      input.status === "cancelled" && ["requested", "booked"].includes(current.status) &&
      (record.userId === req.account.id || isLawyer)
    ) || (
      isLawyer && input.status === "booked" && current.status === "requested"
    ) || (
      isLawyer && input.status === "completed" && current.status === "booked"
    );
    if (!allowed) throw new HttpError(409, "This consultation status cannot be changed that way.");
    if (input.status === "booked" && !current.demo && current.paymentStatus !== "paid")
      throw new HttpError(409, "The client must complete a verified payment before you accept this request.");
    if (input.status === "booked" && new Date(current.startsAt).getTime() < Date.now())
      throw new HttpError(409, "This slot has passed. Please arrange a new consultation.");
    }
    await tx.update(consultations).set({
      ...input, ...(input.status === "cancelled" ? { cancelledBy: isLawyer ? "lawyer" as const : "client" as const } : {}),
    }).where(eq(consultations.id, id));
  });
  if (input.status) await notify(isLawyer ? record.userId : record.lawyerOwnerId,
    `Consultation ${input.status}`,
    input.status === "booked" ? "The lawyer accepted your paid consultation request."
      : input.status === "cancelled" && isLawyer && record.paymentStatus === "paid"
        ? "The lawyer cancelled your consultation. You can request a full refund in payment history."
        : `Your consultation about ${record.topic} is now ${input.status}.`,
    `/consultations/${id}`);
  res.json(api.UpdateConsultationResponse.parse(await accessibleConsultation(req.account, id)));
});

router.get("/consultations/:id/messages", async (req, res): Promise<void> => {
  const { id } = api.ListMessagesParams.parse(req.params);
  await accessibleConsultation(req.account, id);
  res.json(api.ListMessagesResponse.parse(await db.select().from(messages).where(eq(messages.consultationId, id)).orderBy(asc(messages.createdAt))));
});

router.post("/consultations/:id/messages", async (req, res): Promise<void> => {
  const { id } = api.SendMessageParams.parse(req.params);
  const input = api.SendMessageBody.parse(req.body);
  if (!input.content.trim()) throw new HttpError(400, "Please write a message.");
  const record = await accessibleConsultation(req.account, id);
  if (record.userId !== req.account.id && record.lawyerOwnerId !== req.account.id) throw new HttpError(403, "Only consultation participants can send messages.");
  if (["cancelled", "completed"].includes(record.status)) throw new HttpError(409, "This consultation is closed. Its messages are read-only.");
  const [message] = await db.insert(messages).values({
    id: randomUUID(), consultationId: id, content: input.content.trim(),
    sender: record.userId === req.account.id ? "client" : "lawyer", senderName: req.account.name,
  }).returning();
  await notify(record.userId === req.account.id ? record.lawyerOwnerId : record.userId,
    "New consultation message", `${req.account.name} sent a message in your consultation.`, `/consultations/${id}`);
  res.status(201).json(api.SendMessageResponse.parse(message));
});

router.get("/consultations/:id/deliverables", async (req, res): Promise<void> => {
  const { id } = api.ListDeliverablesParams.parse(req.params);
  const record = await accessibleConsultation(req.account, id);
  const privileged = record.lawyerOwnerId === req.account.id || req.account.role === "admin";
  res.json(api.ListDeliverablesResponse.parse(await db.select().from(deliverables).where(and(
    eq(deliverables.consultationId, id), privileged ? undefined : eq(deliverables.status, "delivered"),
  )).orderBy(asc(deliverables.createdAt))));
});

router.post("/consultations/:id/deliverables", async (req, res): Promise<void> => {
  const { id } = api.CreateDeliverableParams.parse(req.params);
  const input = api.CreateDeliverableBody.parse(req.body);
  const record = await accessibleConsultation(req.account, id);
  if (record.lawyerOwnerId !== req.account.id) throw new HttpError(403, "Only the assigned lawyer can prepare documents.");
  if (!["booked", "completed"].includes(record.status)) throw new HttpError(409, "Accept this consultation before preparing a document.");
  if (!input.title.trim() || (input.status === "delivered" && !input.content.trim())) throw new HttpError(400, "A title and non-empty content are required for delivery.");
  const [document] = await db.insert(deliverables).values({ ...input, title: input.title.trim(), id: randomUUID(), consultationId: id }).returning();
  if (input.status === "delivered") await notify(record.userId, "Your document is ready", "Your lawyer has delivered a document. Open the consultation to read it.", `/consultations/${id}`);
  res.status(201).json(api.CreateDeliverableResponse.parse(document));
});

router.patch("/deliverables/:id", async (req, res): Promise<void> => {
  const { id } = api.UpdateDeliverableParams.parse(req.params);
  const input = api.UpdateDeliverableBody.parse(req.body);
  const [document] = await db.select().from(deliverables).where(eq(deliverables.id, id));
  if (!document) throw new HttpError(404, "Document not found.");
  const record = await accessibleConsultation(req.account, document.consultationId);
  if (record.lawyerOwnerId !== req.account.id) throw new HttpError(403, "Only the assigned lawyer can edit this document.");
  if (record.status === "cancelled") throw new HttpError(409, "The consultation was cancelled.");
  if (!input.title.trim() || (input.status === "delivered" && !input.content.trim())) throw new HttpError(400, "A title and non-empty content are required for delivery.");
  if (document.status === "delivered" && input.status === "draft") throw new HttpError(409, "A delivered document cannot be hidden from the client.");
  const [updated] = await db.update(deliverables).set({ ...input, title: input.title.trim() }).where(eq(deliverables.id, id)).returning();
  if (input.status === "delivered") await notify(record.userId, "Document updated", "Your lawyer has delivered or updated a document.", `/consultations/${record.id}`);
  res.json(api.UpdateDeliverableResponse.parse(updated));
});

router.post("/consultations/:id/review", async (req, res): Promise<void> => {
  const { id } = api.CreateReviewParams.parse(req.params);
  const input = api.CreateReviewBody.parse(req.body);
  const record = await accessibleConsultation(req.account, id);
  if (record.userId !== req.account.id) throw new HttpError(403, "Only the client can review this consultation.");
  if (record.status !== "completed" || record.demo) throw new HttpError(409, "Reviews are available only after completing a consultation with a real lawyer.");
  const [review] = await db.insert(reviews).values({
    ...input, comment: input.comment.trim(), id: randomUUID(), consultationId: id,
    lawyerId: record.lawyerId, userId: req.account.id, clientName: req.account.name.split(" ")[0] || "Client",
  }).returning();
  res.status(201).json(api.CreateReviewResponse.parse(review));
});

export default router;
