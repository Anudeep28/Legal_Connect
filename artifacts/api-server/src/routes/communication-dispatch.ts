import type { RequestHandler } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { communicationTick } from "../lib/communication-worker";

// An external minute scheduler can wake an autoscaling API even without visitors.
// This machine-authenticated route must be mounted before browser session/CSRF middleware.
export const dispatchCommunications: RequestHandler = async (req, res) => {
  const expected = process.env.COMMUNICATION_WORKER_SECRET;
  if (!expected || expected.length < 32) {
    res.status(503).json({ error: "Scheduled dispatch is not configured." }); return;
  }
  const authorization = req.get("authorization") || "";
  const actual = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const digest = (text: string) => createHash("sha256").update(text).digest();
  if (!actual || !timingSafeEqual(digest(actual), digest(expected))) {
    res.status(401).json({ error: "Scheduler authorization required." }); return;
  }
  const result = await communicationTick();
  if (result === false) { res.status(503).json({ error: "Dispatch failed; persisted work will be retried." }); return; }
  res.status(202).json({ ok: true });
};
