import { Hono } from "hono";
import { logger } from "hono/logger";
import { createCorsConfig, requireAuth } from "@filtreplante/auth";
import { errorHandler } from "./middleware/error";
import sessionsRoutes from "./routes/sessions";
import importWaveRoutes from "./routes/import-wave";
import invoicesRoutes from "./routes/invoices";
import reconcileRoutes from "./routes/reconcile";
import summaryRoutes from "./routes/summary";
import autoMatchRoutes from "./routes/auto-match";
import metadataRoutes from "./routes/metadata";
import cashRoutes from "./routes/cash";
import type { Env } from "./types/env";

const app = new Hono<{ Bindings: Env }>();

// Middleware global
app.use("*", logger());
app.use("*", createCorsConfig() as any);

// Auth sur toutes les routes API
app.use("/api/*", requireAuth as any);

// Route auth/me
app.get("/api/auth/me", (c) => {
  return c.json(c.get("user" as never));
});

// Routes
app.route("/api/sessions", sessionsRoutes);
app.route("/api/sessions", importWaveRoutes);
app.route("/api/invoices", invoicesRoutes);
app.route("/api/reconcile", reconcileRoutes);
app.route("/api/summary", summaryRoutes);
app.route("/api/auto-match", autoMatchRoutes);
app.route("/api/metadata", metadataRoutes);
app.route("/api/cash", cashRoutes);

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "filtreplante-khalis" });
});

app.get("/", (c) => {
  return c.json({
    service: "Filtreplante Khalis API",
    version: "1.0.0",
  });
});

app.onError(errorHandler);

export default app;
