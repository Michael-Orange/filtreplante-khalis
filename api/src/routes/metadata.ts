import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import { waveTransactions } from "../schema/khalis";
import { projects } from "../schema/facture";
import { users } from "../schema/users";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

// Get projects from facture DB (for dropdown)
app.get("/projects", async (c) => {
  const db = createDb(c.env.DATABASE_URL);

  const allProjects = await db
    .select({
      id: projects.id,
      number: projects.number,
      name: projects.name,
      isCompleted: projects.isCompleted,
    })
    .from(projects)
    .orderBy(projects.name);

  return c.json(allProjects);
});

// Get users from referentiel (for person allocation dropdown)
// Exclude Fatou, Michael, Marine — add Bocar as static entry
app.get("/persons", async (c) => {
  const db = createDb(c.env.DATABASE_URL);

  const allUsers = await db
    .select({
      id: users.id,
      nom: users.nom,
    })
    .from(users)
    .where(eq(users.actif, true));

  const excluded = ["Fatou", "Michael", "Marine"];
  const filtered = allUsers.filter((u) => !excluded.includes(u.nom));

  // Add Bocar as a static entry
  const persons = [
    ...filtered.map((u) => ({ name: u.nom })),
    { name: "Bocar" },
  ].sort((a, b) => a.name.localeCompare(b.name));

  return c.json(persons);
});

const updateMetadataSchema = z.object({
  projectId: z.string().nullable().optional(),
  allocations: z
    .array(
      z.object({
        name: z.string().min(1),
        amount: z.number().min(0),
      })
    )
    .optional(),
});

// Update transaction metadata (project + allocations)
app.patch("/transactions/:id", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const id = c.req.param("id");
  const body = await c.req.json();

  const parsed = updateMetadataSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const updates: Record<string, any> = {};
  if (parsed.data.projectId !== undefined) updates.projectId = parsed.data.projectId;
  if (parsed.data.allocations !== undefined) updates.allocations = parsed.data.allocations;

  if (Object.keys(updates).length === 0) {
    throw new AppError(400, "Aucune modification");
  }

  await db
    .update(waveTransactions)
    .set(updates)
    .where(eq(waveTransactions.id, id));

  return c.json({ success: true });
});

export default app;
