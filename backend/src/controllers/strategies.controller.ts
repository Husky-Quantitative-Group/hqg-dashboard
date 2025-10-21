import { Request, Response } from "express";
import { StrategyModel } from "../models/strategy.model";

export const getStrategies = async (_req: Request, res: Response) => {
  try {
    const strategies = await StrategyModel.find({});
    res.json(strategies);
  } catch (error) {
    console.error("Failed to fetch strategies", error);
    res.status(500).json({ message: "Failed to fetch strategies" });
  }
};
