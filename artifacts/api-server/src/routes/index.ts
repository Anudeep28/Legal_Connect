import { Router, type IRouter } from "express";
import marketplaceRouter from "./marketplace";
import accountRouter from "./account";
import consultationsRouter from "./consultations";
import documentsRouter from "./documents";
import adminRouter from "./admin";
import adminGrievancesRouter from "./admin-grievances";
import writingRouter from "./writing";
import billingRouter from "./billing";
import communicationRouter from "./communication";
import grievancesRouter from "./grievances";

const router: IRouter = Router();

router.use(marketplaceRouter);
router.use(accountRouter);
router.use(grievancesRouter);
router.use(consultationsRouter);
router.use(documentsRouter);
router.use(adminGrievancesRouter);
router.use(adminRouter);
router.use(writingRouter);
router.use(billingRouter);
router.use(communicationRouter);

export default router;
