import type { RequestHandler, ErrorRequestHandler } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, accounts } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { notifications } from "@workspace/db";
import { getClerkProxyHost } from "./clerkProxyMiddleware";

export type Account = typeof accounts.$inferSelect;
declare global {
  namespace Express {
    interface Request { account: Account; }
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Cookie-authenticated writes must be initiated on this same website.
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) { next(); return; }
  const origin = req.get("origin");
  if (req.get("sec-fetch-site") === "cross-site") { next(new HttpError(403, "Cross-site requests are not allowed.")); return; }
  if (origin) {
    try {
      if (new URL(origin).host !== getClerkProxyHost(req)) {
        next(new HttpError(403, "Request origin does not match this website.")); return;
      }
    } catch { next(new HttpError(403, "Invalid request origin.")); return; }
  }
  next();
};

export const requireAccount: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Please sign in to continue." }); return; }
  let [account] = await db.select().from(accounts).where(eq(accounts.id, userId));
  if (!account) {
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    if (!primary || primary.verification?.status !== "verified") {
      res.status(403).json({ error: "Verify your email address before using your account." }); return;
    }
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(accounts).values({
        id: userId,
        name: user.fullName || user.firstName || primary.emailAddress.split("@")[0] || "Client",
        email: primary.emailAddress,
      }).onConflictDoNothing().returning();
      if (created) await tx.insert(notifications).values({
        id: randomUUID(), userId,
        title: "Welcome to Consult with Lawyer",
        body: "This is a separate pilot. Example lawyer profiles are illustrative and cannot accept payments. Checkout stays disabled until provider verification. Please do not submit sensitive documents until your lawyer's identity and engagement are confirmed.",
        link: "/dashboard",
      });
    });
    [account] = await db.select().from(accounts).where(eq(accounts.id, userId));
  }
  if (!account) throw new HttpError(503, "Your account could not be initialized. Please retry.");
  if (account.status !== "active") {
    res.status(403).json({ error: "Your account is not active. Please contact the platform owner." }); return;
  }
  req.account = account;
  next();
};

export const requireLawyer: RequestHandler = (req, res, next) => {
  if (req.account.role !== "lawyer") { res.status(403).json({ error: "A lawyer account is required. Submit your professional profile to apply." }); return; }
  next();
};
export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.account.role !== "admin") { res.status(403).json({ error: "Administrator access is required." }); return; }
  next();
};

export const apiErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return; }
  if (err?.name === "ZodError") { res.status(400).json({ error: "Please check the submitted fields.", details: err.issues }); return; }
  const code = err?.code || err?.cause?.code;
  if (code === "23505") { res.status(409).json({ error: "This record already exists or the selected slot is no longer available." }); return; }
  if (err?.type === "entity.too.large") { res.status(413).json({ error: "The recording is too large. Record a shorter segment." }); return; }
  // Database wrapper error messages can contain SQL parameters (legal content).
  req.log.error({ name: err?.name, code }, "API request failed");
  res.status(500).json({ error: "The request could not be completed. Please try again." });
};
