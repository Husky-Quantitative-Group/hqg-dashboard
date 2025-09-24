import express from "express";
import { prisma } from "./db";

const app = express();
app.use(express.json());

// test route
app.get("/api/test", async (req, res) => {
  res.json("test");
});

export default app;