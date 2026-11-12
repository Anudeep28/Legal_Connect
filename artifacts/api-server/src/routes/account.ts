import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import { db, accounts, notifications } from "@workspace/db";
import {
  GetMeResponse, UpdateMeBody, UpdateMeResponse, ListNotificationsResponse,
  ReadNotificationParams, ReadNotificationResponse,
} from "@workspace/api-zod";
import { requireAccount, HttpError } from "../middlewares/access";

const router: IRouter = Router();
router.use(["/me", "/notifications"], requireAccount);

router.get("/me", async (req, res): Promise<void> => {
  res.json(GetMeResponse.parse(req.account));
});
router.patch("/me", async (req, res): Promise<void> => {
  const input = UpdateMeBody.parse(req.body);
  if (input.name !== undefined && !input.name.trim()) throw new HttpError(400, "Please enter your name.");
  const [account] = await db.update(accounts).set({
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.emailNotifications !== undefined ? { emailNotifications: input.emailNotifications } : {}),
    ...(input.pushNotifications !== undefined ? { pushNotifications: input.pushNotifications } : {}),
  }).where(eq(accounts.id, req.account.id)).returning();
  res.json(UpdateMeResponse.parse(account));
});
router.get("/notifications", async (req, res): Promise<void> => {
  res.json(ListNotificationsResponse.parse(await db.select().from(notifications)
    .where(eq(notifications.userId, req.account.id)).orderBy(desc(notifications.createdAt)).limit(200)));
});
router.patch("/notifications/:id/read", async (req, res): Promise<void> => {
  const { id } = ReadNotificationParams.parse(req.params);
  const [notification] = await db.update(notifications).set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.userId, req.account.id))).returning();
  if (!notification) throw new HttpError(404, "Notification not found.");
  res.json(ReadNotificationResponse.parse(notification));
});
export default router;
