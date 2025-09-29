import { Router } from "express";
import { getStrategies } from "../controllers/strategies.controller";

const router = Router();

router.get("/", getStrategies);

export const strategiesRouter = router;
