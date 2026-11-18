import { Router, type IRouter, type RequestHandler } from "express";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { accounts, auditLogs, db, grievances } from "@workspace/db";
import * as api from "@workspace/api-zod";
import {
  HttpError,
  requireAccount,
  requireAdmin,
  requireGrievanceOfficer,
} from "../middlewares/access";

export function createAdminGrievancesRouter(dependencies: { authMiddlewares?: RequestHandler[] } = {}): IRouter {
  const router: IRouter = Router();
  router.use("/admin/grievances", ...(dependencies.authMiddlewares ?? [requireAccount, requireAdmin]));

  router.get("/admin/grievances", requireGrievanceOfficer, async (_req, res): Promise<void> => {
    const rows = await db.select({
      id: grievances.id,
      category: grievances.category,
      description: grievances.description,
      status: grievances.status,
      officerResponse: grievances.officerResponse,
      submittedAt: grievances.submittedAt,
      updatedAt: grievances.updatedAt,
      respondedAt: grievances.respondedAt,
      clientName: accounts.name,
      clientEmail: accounts.email,
    }).from(grievances).innerJoin(accounts, eq(grievances.clientId, accounts.id))
      .orderBy(desc(grievances.submittedAt)).limit(500);
    res.set("Cache-Control", "no-store").json(api.ListAdminGrievancesResponse.parse(rows));
  });

  router.patch("/admin/grievances/:id", requireGrievanceOfficer, async (req, res): Promise<void> => {
    const { id } = api.UpdateAdminGrievanceParams.parse(req.params);
    const input = api.UpdateAdminGrievanceBody.parse(req.body);
    if (input.status === undefined && input.response === undefined)
      throw new HttpError(400, "Choose a status or enter an officer response.");
    const responseText = input.response?.trim();
    if (input.response !== undefined && (responseText?.length ?? 0) < 3)
      throw new HttpError(400, "Write a response of at least 3 characters.");

    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(grievances).where(eq(grievances.id, id)).for("update");
      if (!current) throw new HttpError(404, "Grievance not found.");
      const nextStatus = input.status ?? current.status;
      if (input.status && input.status !== current.status) {
        const allowed = (current.status === "submitted" && ["under_review", "resolved"].includes(input.status)) ||
          (current.status === "under_review" && input.status === "resolved");
        if (!allowed) throw new HttpError(409, "A resolved grievance cannot be reopened or moved backwards.");
      }
      if (nextStatus === "resolved" && !(responseText ?? current.officerResponse).trim())
        throw new HttpError(400, "Record an officer response before resolving this grievance.");
      const responseChanged = input.response !== undefined;
      const [record] = await tx.update(grievances).set({
        status: nextStatus,
        ...(responseChanged ? {
          officerResponse: responseText!,
          respondedBy: req.account.id,
          respondedAt: new Date().toISOString(),
        } : {}),
        updatedAt: new Date().toISOString(),
      }).where(eq(grievances.id, id)).returning();
      await tx.insert(auditLogs).values({
        id: randomUUID(),
        actorId: req.account.id,
        targetId: id,
        action: responseChanged ? "grievance:officer-response-recorded" : "grievance:status-updated",
        reason: `Grievance status ${current.status} → ${record!.status}${responseChanged ? "; officer response recorded" : ""}.`,
      });
      return record!;
    });

    const [row] = await db.select({
      id: grievances.id,
      category: grievances.category,
      description: grievances.description,
      status: grievances.status,
      officerResponse: grievances.officerResponse,
      submittedAt: grievances.submittedAt,
      updatedAt: grievances.updatedAt,
      respondedAt: grievances.respondedAt,
      clientName: accounts.name,
      clientEmail: accounts.email,
    }).from(grievances).innerJoin(accounts, eq(grievances.clientId, accounts.id))
      .where(eq(grievances.id, updated.id));
    res.json(api.UpdateAdminGrievanceResponse.parse(row));
  });

  return router;
}

export default createAdminGrievancesRouter();
