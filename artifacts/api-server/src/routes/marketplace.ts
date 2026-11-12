import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, lawyers, reviews, accounts, notifications } from "@workspace/db";
import {
  GetPlatformResponse, ListLawyersQueryParams, ListLawyersResponse, GetLawyerParams,
  GetLawyerResponse, GetLawyerSlotsParams, GetLawyerSlotsResponse, ListLawyerReviewsParams,
  ListLawyerReviewsResponse, GetLawyerProfileResponse, SaveLawyerProfileBody,
  SaveLawyerProfileResponse,
} from "@workspace/api-zod";
import { requireAccount, HttpError } from "../middlewares/access";
import { availableSlots, categoryNames, lawyerViews } from "../lib/legal";
import { legalTemplates } from "../data/templates";
import { supportedLanguages } from "../data/languages";
import { paymentsEnabled } from "../lib/razorpay";
import { communicationServices } from "../lib/communication-config";
import { isAiAvailable } from "../lib/ai-providers";

const router: IRouter = Router();

router.get("/platform", async (_req, res): Promise<void> => {
  const rows = await db.select().from(lawyers).where(eq(lawyers.approvalStatus, "approved"));
  const ai = await isAiAvailable();
  res.json(GetPlatformResponse.parse({
    name: "Consult with Lawyer",
    demo: rows.some((l) => l.demo),
    paymentsEnabled: paymentsEnabled(),
    ...communicationServices(),
    ...ai,
    categories: categoryNames.map(([id, name, description]) => ({ id, name, description, count: rows.filter((l) => l.practiceAreas.includes(name)).length })),
    templates: legalTemplates.map((t) => ({
      ...t,
      description: /CrPC|IPC/.test(t.content) ? `${t.description}. Legacy statutory references: verify against current applicable law before use.` : t.description,
      fields: t.fields.map((f) => ({ ...f, required: Boolean(f.required) })),
    })),
    languages: supportedLanguages.map((l) => l.name),
    plans: [
      { id: "trial", name: "Free trial", price: 0, description: "Original 2-day document trial", features: ["Explore the legal document workspace", "Indian legal templates", "DOCX, PDF and Markdown exports"] },
      { id: "single", name: "Single document", price: 10, description: "One new legal document", features: ["One document credit", "Template filling and editing", "Export in your preferred format"] },
      { id: "monthly", name: "Monthly unlimited", price: 499, description: "30 days of unlimited documents", features: ["Unlimited new documents", "All legal templates", "AI assistance billed separately", "30 days of document access"] },
    ],
    lawyerCount: rows.length,
    onlineCount: rows.filter((l) => l.online).length,
  }));
});

router.get("/lawyers", async (req, res): Promise<void> => {
  const params = ListLawyersQueryParams.parse(req.query);
  const all = await db.select().from(lawyers).where(eq(lawyers.approvalStatus, "approved"));
  const search = params.search?.trim().toLowerCase();
  const area = categoryNames.find(([id, name]) => id === params.practiceArea || name === params.practiceArea)?.[1] || params.practiceArea;
  let rows = await lawyerViews(all.filter((l) =>
    (!search || [l.name, l.title, l.city, ...l.practiceAreas, ...l.languages].join(" ").toLowerCase().includes(search)) &&
    (!area || l.practiceAreas.includes(area)) &&
    (!params.language || l.languages.includes(params.language)) &&
    (params.online !== "true" || l.online)
  ));
  rows = rows.sort((a, b) => {
    switch (params.sort) {
      case "fee_asc": return a.fee - b.fee;
      case "fee_desc": return b.fee - a.fee;
      case "experience": return b.experienceYears - a.experienceYears;
      case "rating": return b.rating - a.rating || b.reviewCount - a.reviewCount;
      default: return Number(b.online) - Number(a.online) || b.experienceYears - a.experienceYears;
    }
  });
  res.json(ListLawyersResponse.parse(rows));
});

router.get("/lawyers/:id", async (req, res): Promise<void> => {
  const { id } = GetLawyerParams.parse(req.params);
  const [lawyer] = await db.select().from(lawyers).where(and(eq(lawyers.id, id), eq(lawyers.approvalStatus, "approved")));
  if (!lawyer) throw new HttpError(404, "Lawyer profile not found.");
  res.json(GetLawyerResponse.parse((await lawyerViews([lawyer]))[0]));
});

router.get("/lawyers/:id/slots/:date", async (req, res): Promise<void> => {
  const { id, date } = GetLawyerSlotsParams.parse(req.params);
  const [lawyer] = await db.select().from(lawyers).where(and(eq(lawyers.id, id), eq(lawyers.approvalStatus, "approved")));
  if (!lawyer) throw new HttpError(404, "Lawyer profile not found.");
  res.json(GetLawyerSlotsResponse.parse(await availableSlots(lawyer, date)));
});

router.get("/lawyers/:id/reviews", async (req, res): Promise<void> => {
  const { id } = ListLawyerReviewsParams.parse(req.params);
  res.json(ListLawyerReviewsResponse.parse(await db.select().from(reviews)
    .where(and(eq(reviews.lawyerId, id), eq(reviews.visible, true))).orderBy(desc(reviews.createdAt))));
});

router.get("/lawyer/profile", requireAccount, async (req, res): Promise<void> => {
  const [profile] = await db.select().from(lawyers).where(eq(lawyers.ownerId, req.account.id));
  res.json(GetLawyerProfileResponse.parse(profile ? (await lawyerViews([profile]))[0] : null));
});

router.put("/lawyer/profile", requireAccount, async (req, res): Promise<void> => {
  if (req.account.role === "admin") throw new HttpError(403, "Administrator accounts cannot become lawyer accounts.");
  const input = SaveLawyerProfileBody.parse(req.body);
  const validAreas = new Set(categoryNames.map((c) => c[1] as string));
  if (input.practiceAreas.some((a) => !validAreas.has(a))) throw new HttpError(400, "Select valid practice areas.");
  if (input.languages.some((l) => !supportedLanguages.some((supported) => supported.name === l))) throw new HttpError(400, "Select a supported language.");
  const [existing] = await db.select().from(lawyers).where(eq(lawyers.ownerId, req.account.id));
  const { online, availability, ...credentials } = input;
  const needsReview = !existing || Object.entries(credentials).some(([key, value]) =>
    JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(value));
  const profile = await db.transaction(async (tx) => {
    const values = {
      ...input,
      name: input.name.trim(), title: input.title.trim(),
      practiceAreas: [...new Set(input.practiceAreas)], languages: [...new Set(input.languages)],
      availability: [...new Set(availability)],
      ...(needsReview ? { approvalStatus: "pending" as const, verified: false, rejectionReason: "" } : {}),
    };
    const [saved] = existing
      ? await tx.update(lawyers).set(values).where(eq(lawyers.id, existing.id)).returning()
      : await tx.insert(lawyers).values({ ...values, id: randomUUID(), ownerId: req.account.id }).returning();
    await tx.update(accounts).set({ role: "lawyer" }).where(eq(accounts.id, req.account.id));
    if (needsReview) await tx.insert(notifications).values({
      id: randomUUID(), userId: req.account.id, title: "Professional profile submitted",
      body: "Your profile is pending review. You can use the document workspace while the platform reviews your application.",
      link: "/lawyer/profile",
    });
    return saved!;
  });
  res.json(SaveLawyerProfileResponse.parse((await lawyerViews([profile]))[0]));
});

export default router;
