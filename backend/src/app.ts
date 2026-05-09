import cors from "cors";
import express from "express";

import { getDb } from "./db/index.js";
import { gamesRouter } from "./routes/games.js";

const devOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

export function createApp() {
  // open and migrate the database before serving any request.
  getDb();

  const app = express();

  app.use(cors({ origin: devOrigin, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/games", gamesRouter);

  return app;
}
