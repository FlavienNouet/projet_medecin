import "dotenv/config";
import cors from "cors";
import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.API_PORT ?? 8787);
const apiToken = process.env.API_TOKEN?.trim() || "";
const maxStateBytes = Number(process.env.MAX_STATE_BYTES ?? 1_000_000);

const defaultAllowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
  "http://localhost:5177"
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS?.split(",") ?? defaultAllowedOrigins)
  .map((origin) => origin.trim())
  .filter(Boolean);

const requestCounts = new Map<string, { count: number; resetAt: number }>();

function getClientKey(req: express.Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

function applyRateLimit(maxPerMinute: number): express.RequestHandler {
  return (req, res, next) => {
    const key = `${getClientKey(req)}:${req.path}`;
    const now = Date.now();
    const entry = requestCounts.get(key);

    if (!entry || now >= entry.resetAt) {
      requestCounts.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }

    if (entry.count >= maxPerMinute) {
      return res.status(429).json({ error: "RATE_LIMITED" });
    }

    entry.count += 1;
    return next();
  };
}

function requireApiToken(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!apiToken) {
    next();
    return;
  }

  const provided = req.header("x-api-token")?.trim();
  if (!provided || provided !== apiToken) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  next();
}

app.disable("x-powered-by");

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("CORS_NOT_ALLOWED"));
  },
  methods: ["GET", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-token"]
}));

app.use((_, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/state", applyRateLimit(120), requireApiToken, async (_req, res) => {
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

app.put("/api/state", applyRateLimit(60), requireApiToken, async (req, res) => {
  const state = req.body?.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return res.status(400).json({ error: "INVALID_PAYLOAD" });
  }

  const serializedState = JSON.stringify(state);
  if (Buffer.byteLength(serializedState, "utf8") > maxStateBytes) {
    return res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
  }

  try {
    await prisma.appStateRecord.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        state: serializedState
      },
      update: {
        state: serializedState
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