import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

const StrategySchema = new Schema(
  {
    strategyId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: String,
    owner: String,
    tags: { type: [String], default: [] },
  },
  {
    collection: "strategies",
    timestamps: true,
  }
);

export type Strategy = InferSchemaType<typeof StrategySchema>;

export const StrategyModel: Model<Strategy> =
  (models.Strategy as Model<Strategy> | undefined) || model<Strategy>("Strategy", StrategySchema);
