import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, lawyers, reviews, consultations, accounts, notifications } from "@workspace/db";
import { HttpError, type Account } from "../middlewares/access";
import { GetConsultationResponse, GetLawyerResponse } from "@workspace/api-zod";

export const categoryNames = [
  ["family", "Family & Divorce", "Marriage, separation, custody and family matters"],
  ["property", "Property & Real Estate", "Property disputes, tenancy and real estate"],
  ["criminal", "Criminal Law", "Bail, criminal defence and your legal rights"],
  ["corporate", "Business & Corporate", "Contracts, company matters and business advice"],
  ["employment", "Employment", "Workplace disputes, salary and employment rights"],
  ["consumer", "Consumer Rights", "Refunds, defective products and service disputes"],
  ["civil", "Civil Law", "Civil disputes, recovery and legal notices"],
  ["cyber", "Cyber Law", "Online fraud, privacy and digital disputes"],
] as const;

export async function lawyerViews(rows: (typeof lawyers.$inferSelect)[]) {
  if (!rows.length) return [];
  const aggregates = await db.select({
    lawyerId: reviews.lawyerId,
    rating: sql<number>`avg(${reviews.rating})::float`,
    reviewCount: sql<number>`count(*)::integer`,
  }).from(reviews).where(and(eq(reviews.visible, true), inArray(reviews.lawyerId, rows.map((r) => r.id)))).groupBy(reviews.lawyerId);
  return rows.map((l) => {
    const stats = aggregates.find((a) => a.lawyerId === l.id);
    return GetLawyerResponse.parse({ ...l, rating: stats ? Math.round(stats.rating * 10) / 10 : 0, reviewCount: stats?.reviewCount ?? 0 });
  });
}

export async function consultationRows(account: Account, id?: string) {
  const rows = await db.select({
    consultation: consultations,
    lawyer: lawyers,
    client: accounts,
  }).from(consultations).innerJoin(lawyers, eq(consultations.lawyerId, lawyers.id))
    .innerJoin(accounts, eq(consultations.userId, accounts.id))
    .where(and(
      id ? eq(consultations.id, id) : undefined,
      account.role === "admin" ? undefined : sql`(${consultations.userId} = ${account.id} OR ${lawyers.ownerId} = ${account.id})`,
    ));
  return rows.sort((a, b) => b.consultation.createdAt.localeCompare(a.consultation.createdAt)).map((row) => ({
    ...GetConsultationResponse.parse({
      ...row.consultation,
      clientName: row.client.name,
      lawyerName: row.lawyer.name,
      lawyerAvatar: row.lawyer.avatarUrl,
    }),
    lawyerOwnerId: row.lawyer.ownerId,
  }));
}

export async function accessibleConsultation(account: Account, id: string) {
  const [record] = await consultationRows(account, id);
  if (!record) throw new HttpError(404, "Consultation not found.");
  return record;
}

export async function notify(userId: string | null, title: string, body: string, link: string) {
  if (!userId) return;
  await db.insert(notifications).values({ id: randomUUID(), userId, title, body, link });
}

export async function availableSlots(lawyer: typeof lawyers.$inferSelect, date: string) {
  const day = new Date(`${date}T12:00:00+05:30`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date)
    throw new HttpError(400, "Choose a valid date.");
  if (!lawyer.availability.includes(day.getUTCDay())) return [];
  const now = Date.now();
  if (day.getTime() > now + 31 * 86400000) throw new HttpError(400, "Please choose a date within the next 30 days.");
  const taken = await db.select({ startsAt: consultations.startsAt }).from(consultations).where(and(
    eq(consultations.lawyerId, lawyer.id), ne(consultations.status, "cancelled"),
  ));
  const occupied = new Set(taken.map((t) => new Date(t.startsAt).toISOString()));
  const slots: string[] = [];
  for (let hour = 9; hour < 18; hour++) {
    for (const minutes of [0, 30]) {
      const time = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+05:30`);
      if (time.getTime() > now + 5 * 60000 && !occupied.has(time.toISOString())) slots.push(time.toISOString());
    }
  }
  return slots;
}
