import { Router, type IRouter, type RequestHandler } from "express";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, grievances } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { HttpError, requireAccount } from "../middlewares/access";

export function createGrievancesRouter(dependencies: { authMiddlewares?: RequestHandler[] } = {}): IRouter {
  const router: IRouter = Router();
  router.use("/grievances", ...(dependencies.authMiddlewares ?? [requireAccount]));

  router.get("/grievances", async (req, res): Promise<void> => {
    if (req.account.role !== "client") throw new HttpError(403, "A client account is required to submit or track grievances.");
    const rows = await db.select().from(grievances)
      .where(eq(grievances.clientId, req.account.id))
      .orderBy(desc(grievances.submittedAt)).limit(100);
    res.set("Cache-Control", "no-store").json(api.ListMyGrievancesResponse.parse(rows));
  });

  router.post("/grievances", async (req, res): Promise<void> => {
    if (req.account.role !== "client") throw new HttpError(403, "A client account is required to submit or track grievances.");
    const input = api.SubmitGrievanceBody.parse(req.body);
    const description = input.description.trim();
    if (description.length < 10) throw new HttpError(400, "Describe the service issue in at least 10 characters.");
    const [record] = await db.insert(grievances).values({
      id: randomUUID(),
      clientId: req.account.id,
      category: input.category,
      description,
    }).returning();
    res.status(201).json(api.SubmitGrievanceResponse.parse(record));
  });

  return router;
}

export default createGrievancesRouter();
