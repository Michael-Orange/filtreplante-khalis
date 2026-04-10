import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import { cashAllocations } from "../schema/khalis";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

// --- Schemas ---

const createCashSchema = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  personName: z.string().min(1),
  amount: z.number().min(0).default(0),
});

const updateCashSchema = z.object({
  amount: z.number().min(0).optional(),
  personName: z.string().min(1).optional(),
});

// --- Routes ---

// List all cash allocations for a session
app.get("/:sessionId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  const rows = await db
    .select()
    .from(cashAllocations)
    .where(eq(cashAllocations.sessionId, sessionId));

  return c.json(rows);
});

// Create or update a cash allocation (UPSERT on session+project+person)
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createCashSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const { sessionId, projectId, personName, amount } = parsed.data;
  const db = createDb(c.env.DATABASE_URL);

  const id = crypto.randomUUID();

  const [row] = await db
    .insert(cashAllocations)
    .values({
      id,
      sessionId,
      projectId,
      personName,
      amount: amount.toString(),
    })
    .onConflictDoUpdate({
      target: [
        cashAllocations.sessionId,
        cashAllocations.projectId,
        cashAllocations.personName,
      ],
      set: {
        amount: amount.toString(),
      },
    })
    .returning();

  return c.json(row, 201);
});

// Update a cash allocation by id
app.patch("/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json();

  const parsed = updateCashSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const updates: Record<string, any> = {};
  if (parsed.data.amount !== undefined) {
    updates.amount = parsed.data.amount.toString();
  }
  if (parsed.data.personName !== undefined) {
    updates.personName = parsed.data.personName;
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, "Aucune modification");
  }

  const [row] = await db
    .update(cashAllocations)
    .set(updates)
    .where(eq(cashAllocations.id, id))
    .returning();

  if (!row) throw new AppError(404, "Allocation introuvable");

  return c.json(row);
});

// Delete a single cash allocation line
app.delete("/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const id = c.req.param("id");

  await db.delete(cashAllocations).where(eq(cashAllocations.id, id));

  return c.json({ success: true });
});

// Delete all cash allocations for a (session, project) pair (used for "delete block")
app.delete("/session/:sessionId/project/:projectId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");
  const projectId = c.req.param("projectId");

  await db
    .delete(cashAllocations)
    .where(
      and(
        eq(cashAllocations.sessionId, sessionId),
        eq(cashAllocations.projectId, projectId),
      ),
    );

  return c.json({ success: true });
});

export default app;
