import express from "express";
import cors from "cors";
import { strategiesRouter } from "./routes/strategies.routes";

const app = express();
const clientOrigin = "http://localhost:5173";

app.use(cors({ origin: clientOrigin }));
app.use(express.json());
app.use("/api/strategies", strategiesRouter);

// test route
app.get("/api/test", async (req, res) => {
  res.json("test");
});

export default app;
