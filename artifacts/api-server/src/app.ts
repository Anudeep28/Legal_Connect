import express, { type Express } from "express";
import path from "node:path";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { apiErrorHandler, csrfProtection } from "./middlewares/access";
import { razorpayWebhook } from "./routes/billing";
import { dispatchCommunications } from "./routes/communication-dispatch";
import { twilioVideoRecordingWebhook } from "./lib/call-recordings";
import healthRouter from "./routes/health";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.set("trust proxy", 1);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: false }));
app.post("/api/billing/webhook", express.raw({ type: "application/json", limit: "256kb" }), razorpayWebhook);
app.post("/api/communications/dispatch", dispatchCommunications);
app.post("/api/communications/twilio-video-recordings", express.urlencoded({ extended: false, limit: "256kb" }), twilioVideoRecordingWebhook);
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
// Public liveness endpoint: platform probes must not require Clerk or database access.
app.use("/api", healthRouter);
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
})));
app.use("/api", csrfProtection);
app.use("/api", router);
const frontendDir = process.env.FRONTEND_DIST_DIR?.trim();
if (frontendDir) {
  const absoluteFrontendDir = path.resolve(frontendDir);
  app.use(express.static(absoluteFrontendDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path === "/api" || req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(path.join(absoluteFrontendDir, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}
app.use(apiErrorHandler);

export default app;
