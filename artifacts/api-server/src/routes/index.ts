import { Router, type IRouter } from "express";
import healthRouter from "./health";
import marketplaceRouter from "./marketplace";
import accountRouter from "./account";
import consultationsRouter from "./consultations";
import documentsRouter from "./documents";
import adminRouter from "./admin";
import writingRouter from "./writing";
import billingRouter from "./billing";
import communicationRouter from "./communication";

const router: IRouter = Router();

router.use(healthRouter);
router.use(marketplaceRouter);
router.use(accountRouter);
router.use(consultationsRouter);
router.use(documentsRouter);
router.use(adminRouter);
router.use(writingRouter);
router.use(billingRouter);
router.use(communicationRouter);

export default router;
