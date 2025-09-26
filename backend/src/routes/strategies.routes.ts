import { Router } from "express";
import {
  getAllStrategies,
  getStrategiesErrorMessage,
} from "../controllers/strategies.controller";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const strategies = await getAllStrategies();
    res.json({ strategies });
  } catch (error) {
    const message = getStrategiesErrorMessage(error);
    res.status(500).json({ error: message });
  }
});

export const strategiesRouter = router;
