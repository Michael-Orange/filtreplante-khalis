import { Hono } from "hono";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
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
  label: z.string().min(1).max(200),
  dateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateSessionSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  status: z.string().max(20).optional(),
  archived: z.boolean().optional(),
  dateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Ownership check : un utilisateur non-admin ne peut modifier/supprimer que
 * les sessions qu'il a créées. Admin peut tout. Retourne le createdBy requis
 * ou `null` si admin (= pas de filtre).
 */
function ownerFilter(user: any): string | null {
  if (user?.role === "admin") return null;
  return user?.nom || "__no_one__";
}

// List sessions (archived hidden unless ?showArchived=true and user is admin)
app.get("/", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const user = c.get("user" as never) as any;
  const showArchived = c.req.query("showArchived") === "true" && user?.role === "admin";

  const allSessions = await db
    .select({
      id: sessions.id,
      label: sessions.label,
      dateStart: sessions.dateStart,
      dateEnd: sessions.dateEnd,
      status: sessions.status,
      archived: sessions.archived,
      createdBy: sessions.createdBy,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(showArchived ? undefined : eq(sessions.archived, false))
    .orderBy(desc(sessions.createdAt));

  const waveCounts = await db
    .select({
      sessionId: waveTransactions.sessionId,
      cnt: sql<number>`COUNT(*)::int`,
    })
    .from(waveTransactions)
    .groupBy(waveTransactions.sessionId);

  const linkCounts = await db
    .select({
      sessionId: reconciliationLinks.sessionId,
      cnt: sql<number>`COUNT(DISTINCT ${reconciliationLinks.invoiceId})::int`,
    })
    .from(reconciliationLinks)
    .groupBy(reconciliationLinks.sessionId);

  const waveMap = new Map(waveCounts.map((w) => [w.sessionId, Number(w.cnt)]));
  const linkMap = new Map(linkCounts.map((l) => [l.sessionId, Number(l.cnt)]));

  return c.json(
    allSessions.map((s) => ({
      ...s,
      waveCount: waveMap.get(s.id) ?? 0,
      linkCount: linkMap.get(s.id) ?? 0,
    })),
  );
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

// Delete session (ownership check : créateur ou admin uniquement)
app.delete("/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("id");
  const user = c.get("user" as never) as any;

  const [existing] = await db
    .select({ createdBy: sessions.createdBy })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!existing) throw new AppError(404, "Session introuvable");

  const owner = ownerFilter(user);
  if (owner !== null && existing.createdBy !== owner) {
    throw new AppError(403, "Cette session appartient à un autre utilisateur");
  }

  await db.delete(sessions).where(eq(sessions.id, sessionId));
  return c.json({ success: true });
});

// Update session (ownership check : créateur ou admin uniquement)
app.patch("/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const user = c.get("user" as never) as any;

  const parsed = updateSessionSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const [existing] = await db
    .select({ createdBy: sessions.createdBy })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!existing) throw new AppError(404, "Session introuvable");

  const owner = ownerFilter(user);
  if (owner !== null && existing.createdBy !== owner) {
    throw new AppError(403, "Cette session appartient à un autre utilisateur");
  }

  const updates: Record<string, any> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.archived !== undefined) updates.archived = parsed.data.archived;
  if (parsed.data.dateStart !== undefined) updates.dateStart = parsed.data.dateStart;
  if (parsed.data.dateEnd !== undefined) updates.dateEnd = parsed.data.dateEnd;

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, "Aucune modification");
  }

  await db.update(sessions).set(updates).where(eq(sessions.id, sessionId));
  return c.json({ success: true });
});

export default app;
