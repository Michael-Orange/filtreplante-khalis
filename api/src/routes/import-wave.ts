import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import { sessions, waveTransactions } from "../schema/khalis";
import { parseWaveCsv } from "../lib/csv-parser";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

// Import Wave CSV for a session
app.post("/:sessionId/import-wave", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  // Check session exists
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw new AppError(404, "Session introuvable");

  // Parse body — expect JSON with csvContent field
  const body = await c.req.json();
  const csvContent = body.csvContent;

  if (!csvContent || typeof csvContent !== "string") {
    throw new AppError(400, "csvContent requis (contenu du fichier CSV)");
  }

  const result = parseWaveCsv(csvContent);

  if (result.transactions.length === 0) {
    return c.json({
      imported: 0,
      skipped: result.totalSkipped,
      warnings: result.warnings,
    });
  }

  // Check for duplicate transaction IDs already in this session
  const existingWaves = await db
    .select({ transactionId: waveTransactions.transactionId })
    .from(waveTransactions)
    .where(eq(waveTransactions.sessionId, sessionId));

  const existingIds = new Set(existingWaves.map((w) => w.transactionId));
  const newTransactions = result.transactions.filter(
    (t) => !existingIds.has(t.transactionId)
  );
  const duplicateCount =
    result.transactions.length - newTransactions.length;

  if (newTransactions.length > 0) {
    const rows = newTransactions.map((t) => ({
      id: crypto.randomUUID(),
      sessionId,
      transactionId: t.transactionId,
      transactionDate: t.transactionDate,
      amount: t.amount.toString(),
      counterpartyName: t.counterpartyName,
      counterpartyMobile: t.counterpartyMobile,
      rawLine: t.rawLine,
    }));

    // Transaction atomique : si un batch échoue, rollback complet →
    // pas d'import partiel qui laisserait la session dans un état
    // incohérent. onConflictDoNothing protège aussi contre la race
    // condition si l'unique index (session_id, transaction_id) accroche.
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += 50) {
        await tx
          .insert(waveTransactions)
          .values(rows.slice(i, i + 50))
          .onConflictDoNothing();
      }
    });
  }

  return c.json({
    imported: newTransactions.length,
    duplicates: duplicateCount,
    skipped: result.totalSkipped,
    warnings: result.warnings,
  });
});

// Delete all wave transactions for a session (re-import)
app.delete("/:sessionId/wave-transactions", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  await db
    .delete(waveTransactions)
    .where(eq(waveTransactions.sessionId, sessionId));

  return c.json({ success: true });
});

export default app;
