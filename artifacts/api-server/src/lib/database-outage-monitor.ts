import { randomUUID } from "node:crypto";
import { createDatabaseReadinessProbe } from "../routes/health";
import { logger } from "./logger";

export const DATABASE_OUTAGE_MONITOR_INTERVAL_MS = 30_000;
export const DATABASE_OUTAGE_FAILURE_THRESHOLD = 3;
export const DATABASE_OUTAGE_MONITOR_TIMEOUT_MS = 1_500;

type NoticePhase = "outage" | "recovered";
type DeliveryResult = "sent" | "disabled" | "failed";
type ReadinessCheck = () => Promise<unknown>;
type NoticeSender = (phase: NoticePhase, idempotencyKey: string) => Promise<DeliveryResult>;

export type DatabaseOutageStatus = {
  database: "unknown" | "ready" | "unavailable";
  checkedAt: string | null;
  lastSuccessfulCheckAt: string | null;
};

const noticeCopy: Record<NoticePhase, { subject: string; text: string }> = {
  outage: {
    subject: "Database availability alert",
    text: "The application has failed several consecutive database readiness checks. Database-backed features may be temporarily unavailable. Monitoring continues, and a resolution notice will be sent after connectivity recovers.",
  },
  recovered: {
    subject: "Database availability restored",
    text: "Database readiness checks are succeeding again after a sustained connectivity issue. This is an automated resolution notice.",
  },
};

export async function sendDatabaseOutageEmail(
  phase: NoticePhase,
  idempotencyKey: string,
  fetcher: typeof fetch = fetch,
): Promise<DeliveryResult> {
  const recipient = process.env.OWNER_ADMIN_BOOTSTRAP_EMAIL?.trim();
  const emailDeliveryEnabled = process.env.EMAIL_DELIVERY_ENABLED === "true" &&
    Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  if (!emailDeliveryEnabled || !recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return "disabled";

  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [recipient],
        ...noticeCopy[phase],
      }),
    });
    if (!response.ok) return "failed";
    const result = await response.json() as { id?: unknown };
    return typeof result.id === "string" && result.id.length > 0 ? "sent" : "failed";
  } catch {
    // Provider exceptions can include response details. Do not expose them in logs.
    return "failed";
  }
}

export function createDatabaseOutageMonitor(options: {
  checkDatabase?: ReadinessCheck;
  sendNotice?: NoticeSender;
  intervalMs?: number;
  failureThreshold?: number;
  timeoutMs?: number;
} = {}) {
  const checkDatabase = options.checkDatabase ?? createDatabaseReadinessProbe();
  const sendNotice = options.sendNotice ?? sendDatabaseOutageEmail;
  const intervalMs = options.intervalMs ?? DATABASE_OUTAGE_MONITOR_INTERVAL_MS;
  const failureThreshold = options.failureThreshold ?? DATABASE_OUTAGE_FAILURE_THRESHOLD;
  const timeoutMs = options.timeoutMs ?? DATABASE_OUTAGE_MONITOR_TIMEOUT_MS;

  let failures = 0;
  let outageId: string | null = null;
  let alertAccepted = false;
  let monitorRunning = false;
  let tickRunning = false;
  let missingConfigLogged = false;
  let deliveryFailureLogged = false;
  let databaseStatus: DatabaseOutageStatus["database"] = "unknown";
  let checkedAt: string | null = null;
  let lastSuccessfulCheckAt: string | null = null;

  async function boundedProbe(): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(checkDatabase),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("readiness_timeout")), timeoutMs);
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async function notify(phase: NoticePhase, id: string): Promise<boolean> {
    let result: DeliveryResult;
    try {
      result = await sendNotice(phase, `database-outage-${id}-${phase}`);
    } catch {
      result = "failed";
    }
    if (result === "disabled") {
      if (!missingConfigLogged) {
        logger.warn(
          "Database outage email alerts are not configured; set the existing owner email and email delivery settings.",
        );
        missingConfigLogged = true;
      }
      return false;
    }
    if (result === "failed") {
      if (!deliveryFailureLogged) {
        logger.warn("Database outage email could not be delivered; it will be retried.");
        deliveryFailureLogged = true;
      }
      return false;
    }
    missingConfigLogged = false;
    deliveryFailureLogged = false;
    return true;
  }

  async function checkNow(): Promise<boolean> {
    if (tickRunning) return false;
    tickRunning = true;
    try {
      const healthy = await boundedProbe();
      checkedAt = new Date().toISOString();
      databaseStatus = healthy ? "ready" : "unavailable";
      if (!healthy) {
        failures += 1;
        outageId ??= randomUUID();
        if (failures >= failureThreshold && !alertAccepted) {
          alertAccepted = await notify("outage", outageId);
        }
        return false;
      }

      lastSuccessfulCheckAt = checkedAt;
      failures = 0;
      if (outageId && alertAccepted) {
        const recovered = await notify("recovered", outageId);
        if (!recovered) return true;
      }
      outageId = null;
      alertAccepted = false;
      return true;
    } finally {
      tickRunning = false;
    }
  }

  function start() {
    if (monitorRunning) return () => {};
    monitorRunning = true;
    void checkNow();
    const timer = setInterval(() => { void checkNow(); }, intervalMs);
    timer.unref();
    return () => {
      monitorRunning = false;
      clearInterval(timer);
    };
  }

  function getStatus(): DatabaseOutageStatus {
    return { database: databaseStatus, checkedAt, lastSuccessfulCheckAt };
  }

  return { checkNow, start, getStatus };
}

const processDatabaseOutageMonitor = createDatabaseOutageMonitor();

export function startDatabaseOutageMonitor() {
  return processDatabaseOutageMonitor.start();
}

export function getDatabaseOutageStatus() {
  return processDatabaseOutageMonitor.getStatus();
}
