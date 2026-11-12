import { randomUUID } from "node:crypto";
import twilio from "twilio";
import { and, eq, inArray } from "drizzle-orm";
import { db, consultations, lawyers, accounts, callConsents } from "@workspace/db";
import { HttpError, type Account } from "../middlewares/access";
import { callsEnabled } from "./communication-config";
import { callEligibility, isParticipant } from "./communication-policy";

export function twilioClient() {
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN, { timeout: 10_000, autoRetry: false });
}

export async function issueCallAccess(account: Account, id: string) {
  if (!callsEnabled()) throw new HttpError(503, "Twilio calling is not configured. No call was placed.");
  return db.transaction(async (tx) => {
    // Serialize room creation against acceptance/cancellation and concurrent joins.
    const [c] = await tx.select().from(consultations).where(eq(consultations.id, id)).for("update");
    if (!c) throw new HttpError(404, "Consultation not found.");
    const [lawyer] = await tx.select().from(lawyers).where(eq(lawyers.id, c.lawyerId));
    if (!lawyer || !isParticipant(account, { userId: c.userId, lawyerOwnerId: lawyer.ownerId }))
      throw new HttpError(403, "Only the client and assigned lawyer can join this call.");
    const participants = await tx.select().from(accounts).where(inArray(accounts.id, [c.userId, lawyer.ownerId || ""]));
    if (participants.length !== 2 || participants.some((a) => a.status !== "active") || lawyer.approvalStatus !== "approved")
      throw new HttpError(409, "Both participants must be active and the assigned lawyer must be approved.");
    const eligibility = callEligibility(c, true);
    if (!eligibility.canJoin) throw new HttpError(409, eligibility.reason);
    const client = twilioClient();
    try {
      let room = c.callRoomSid ? await client.video.v1.rooms(c.callRoomSid).fetch() : null;
      if (!room || room.status === "completed") {
        // A unique name per attempt prevents public room links and client-created room names.
        room = await client.video.v1.rooms.create({
          uniqueName: `consultation-${randomUUID()}`, type: "group",
          maxParticipants: 2, recordParticipantsOnConnect: false,
          maxParticipantDuration: Math.max(1, Math.ceil((new Date(c.endsAt).getTime() - Date.now()) / 1000)),
          emptyRoomTimeout: 5, unusedRoomTimeout: 5,
        });
        await tx.update(consultations).set({ callRoomSid: room.sid }).where(eq(consultations.id, id));
      }
      if (room.recordParticipantsOnConnect) {
        await client.video.v1.rooms(room.sid).update({ status: "completed" });
        throw new HttpError(503, "Recording is unexpectedly enabled at the provider. Joining is blocked.");
      }
      const ttl = Math.max(1, Math.min(300, Math.floor((new Date(c.endsAt).getTime() - Date.now()) / 1000)));
      const token = new twilio.jwt.AccessToken(
        process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_API_KEY_SID!, process.env.TWILIO_API_KEY_SECRET!,
        { identity: account.id, ttl },
      );
      token.addGrant(new twilio.jwt.AccessToken.VideoGrant({ room: room.sid }));
      await tx.insert(callConsents).values({ id: randomUUID(), consultationId: id, userId: account.id });
      return { token: token.toJwt(), room: room.sid, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), closesAt: c.endsAt, recordingEnabled: false };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, "Twilio could not prepare the call. No connection is being claimed. Please retry.");
    }
  });
}

export async function closeCallRoom(id: string) {
  const [c] = await db.select().from(consultations).where(eq(consultations.id, id));
  if (!c?.callRoomSid) return;
  try { await twilioClient().video.v1.rooms(c.callRoomSid).update({ status: "completed" }); }
  catch (error) { if ((error as { status?: number }).status !== 404) throw error; }
  await db.update(consultations).set({ callRoomSid: null }).where(
    and(eq(consultations.id, id), eq(consultations.callRoomSid, c.callRoomSid)),
  );
}
