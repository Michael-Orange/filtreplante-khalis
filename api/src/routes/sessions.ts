import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, sql, count } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import {
  sessions,
  waveTransactions,
  reconciliationLinks,
} from "../schema/khalis";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

const createSessionSchema = z.object({
  label: z.string().min(1),
  dateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// List all sessions
app.get("/", async (c) => {
  const db = createDb(c.env.DATABASE_URL);

  const allSessions = await db
    .select({
      id: sessions.id,
      label: sessions.label,
      dateStart: sessions.dateStart,
      dateEnd: sessions.dateEnd,
      status: sessions.status,
      createdBy: sessions.createdBy,
      createdAt: sessions.createdAt,
      waveCount: sql<number>`(SELECT COUNT(*) FROM khalis.wave_transactions WHERE session_id = ${sessions.id})::int`,
      linkCount: sql<number>`(SELECT COUNT(DISTINCT invoice_id) FROM khalis.reconciliation_links WHERE session_id = ${sessions.id})::int`,
    })
    .from(sessions)
    .orderBy(desc(sessions.createdAt));

  return c.json(allSessions);
});

// Create session
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const { label, dateStart, dateEnd } = parsed.data;
  const user = c.get("user" as never) as any;

  const id = crypto.randomUUID();
  const db = createDb(c.env.DATABASE_URL);

  await db.insert(sessions).values({
    id,
    label,
    dateStart,
    dateEnd,
    createdBy: user?.nom || "Inconnu",
  });

  return c.json({ id, label, dateStart, dateEnd }, 201);
});

// Get session detail
app.get("/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("id");

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw new AppError(404, "Session introuvable");

  const waves = await db
    .select()
    .from(waveTransactions)
    .where(eq(waveTransactions.sessionId, sessionId));

  return c.json({ ...session, waveTransactions: waves });
});

// Delete session
app.delete("/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("id");

  const result = await db
    .delete(sessions)
    .where(eq(sessions.id, sessionId));

  return c.json({ success: true });
});

// Update session status
app.patch("/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("id");
  const body = await c.req.json();

  const updates: Record<string, any> = {};
  if (body.status) updates.status = body.status;
  if (body.dateStart) updates.dateStart = body.dateStart;
  if (body.dateEnd) updates.dateEnd = body.dateEnd;
  if (body.label) updates.label = body.label;

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, "Aucune modification");
  }

  await db
    .update(sessions)
    .set(updates)
    .where(eq(sessions.id, sessionId));

  return c.json({ success: true });
});

export default app;
