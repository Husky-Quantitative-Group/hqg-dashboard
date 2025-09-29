import "dotenv/config";
import mongoose from "mongoose";
import app from "./server";

const PORT = Number(process.env.PORT ?? 5000);
const DATABASE_URL = process.env.DATABASE_URL ?? "mongodb://localhost:27017/hqg_dashboard";

mongoose.connect(DATABASE_URL)
  .then(() => console.log(`Connected to MongoDB at ${DATABASE_URL} (db: ${mongoose.connection.name})`))
  .catch(error => console.log(error));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
