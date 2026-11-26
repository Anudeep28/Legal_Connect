import { Router, type IRouter } from "express";
import { HealthCheckResponse, ReadinessCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

export const DATABASE_READINESS_QUERY_TIMEOUT_MS = 1_000;
export const API_READINESS_TIMEOUT_MS = 1_500;

type ReadinessQueryConfig = { text: string; query_timeout: number };
type ReadinessQuery = (config: ReadinessQueryConfig) => Promise<unknown>;
type ReadinessCheck = () => Promise<unknown>;

export function createDatabaseReadinessProbe(
  query: ReadinessQuery = (config) => pool.query(config),
): ReadinessCheck {
  return () => query({
    text: "SELECT 1",
    query_timeout: DATABASE_READINESS_QUERY_TIMEOUT_MS,
  });
}

export function createHealthRouter(
  checkDatabase: ReadinessCheck = createDatabaseReadinessProbe(),
  timeoutMs = API_READINESS_TIMEOUT_MS,
): IRouter {
  const router: IRouter = Router();

  // Liveness must remain independent of authentication and database state.
  router.get("/healthz", (_req, res) => {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  });

  router.get("/readyz", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(checkDatabase),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Readiness check timed out.")), timeoutMs);
        }),
      ]);
      res.json(ReadinessCheckResponse.parse({ status: "ready", database: "ok" }));
    } catch (error) {
      req.log?.warn(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Database readiness check failed",
      );
      res.status(503).json(ReadinessCheckResponse.parse({
        status: "not_ready",
        database: "unavailable",
      }));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  });

  return router;
}

export default createHealthRouter();
