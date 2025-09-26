import express from "express";
import { prisma } from "./db";
import { strategiesRouter } from "./routes/strategies.routes";

const app = express();
app.use(express.json());
app.use("/api/strategies", strategiesRouter);

// test route
app.get("/api/test", async (req, res) => {
  res.json("test");
});

export default app;
