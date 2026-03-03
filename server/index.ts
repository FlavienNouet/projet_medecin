import "dotenv/config";
import cors from "cors";
import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.API_PORT ?? 8787);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/state", async (_req, res) => {
  try {
    const row = await prisma.appStateRecord.findUnique({ where: { id: 1 } });
    if (!row) {
      return res.status(404).json({ error: "STATE_NOT_FOUND" });
    }

    return res.json({ state: JSON.parse(row.state) });
  } catch (error) {
    return res.status(500).json({ error: "DB_READ_FAILED", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.put("/api/state", async (req, res) => {
  const state = req.body?.state;
  if (!state) {
    return res.status(400).json({ error: "INVALID_PAYLOAD" });
  }

  try {
    await prisma.appStateRecord.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        state: JSON.stringify(state)
      },
      update: {
        state: JSON.stringify(state)
      }
    });

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: "DB_WRITE_FAILED", message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.listen(port, () => {
  console.log(`API SQLite/Prisma active sur http://localhost:${port}`);
});