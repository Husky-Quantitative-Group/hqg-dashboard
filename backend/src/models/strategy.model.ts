import { Schema, model, models, type Model, type InferSchemaType } from "mongoose";

const StrategySchema = new Schema(
  {
    strategyId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String },
    owner: { type: String },
    project: { type: String, required: true },
    repository: { type: String, required: true },
    branch: { type: String, required: true },
    githubPath: { type: String, required: true },
    htmlUrl: { type: String, required: true },
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
