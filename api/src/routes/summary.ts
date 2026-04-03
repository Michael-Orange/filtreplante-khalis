import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import {
  sessions,
  waveTransactions,
  reconciliationLinks,
} from "../schema/khalis";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

// Get summary for a session
app.get("/:sessionId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw new AppError(404, "Session introuvable");

  // Total wave imported
  const [waveTotals] = await db
    .select({
      totalAmount: sql<string>`COALESCE(SUM(CAST(${waveTransactions.amount} AS DECIMAL)), 0)`,
      totalCount: sql<number>`COUNT(*)::int`,
    })
    .from(waveTransactions)
    .where(eq(waveTransactions.sessionId, sessionId));

  // Total reconciled (wave + cash)
  const [reconTotals] = await db
    .select({
      totalWave: sql<string>`COALESCE(SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL)), 0)`,
      totalCash: sql<string>`COALESCE(SUM(CAST(${reconciliationLinks.cashAmount} AS DECIMAL)), 0)`,
      invoiceCount: sql<number>`COUNT(DISTINCT ${reconciliationLinks.invoiceId})::int`,
    })
    .from(reconciliationLinks)
    .where(eq(reconciliationLinks.sessionId, sessionId));

  // Unmatched wave transactions (not linked to any reconciliation OR partially used)
  const unmatchedWaves = await db
    .select({
      id: waveTransactions.id,
      transactionId: waveTransactions.transactionId,
      transactionDate: waveTransactions.transactionDate,
      amount: waveTransactions.amount,
      counterpartyName: waveTransactions.counterpartyName,
      usedAmount: sql<string>`COALESCE((
        SELECT SUM(CAST(rl.wave_amount AS DECIMAL))
        FROM khalis.reconciliation_links rl
        WHERE rl.wave_transaction_id = ${waveTransactions.id}
      ), 0)`,
    })
    .from(waveTransactions)
    .where(eq(waveTransactions.sessionId, sessionId));

  const orphanWaves = unmatchedWaves
    .filter((w) => {
      const total = parseFloat(w.amount);
      const used = parseFloat(w.usedAmount as string);
      return used < total - 0.01;
    })
    .map((w) => ({
      ...w,
      remaining: parseFloat(w.amount) - parseFloat(w.usedAmount as string),
    }));

  return c.json({
    totalWaveImported: parseFloat(waveTotals.totalAmount),
    totalWaveCount: waveTotals.totalCount,
    totalWaveReconciled: parseFloat(reconTotals.totalWave),
    totalCashReconciled: parseFloat(reconTotals.totalCash),
    invoicesReconciled: reconTotals.invoiceCount,
    orphanWaves,
    orphanWaveCount: orphanWaves.length,
    orphanWaveTotal: orphanWaves.reduce((sum, w) => sum + w.remaining, 0),
  });
});

export default app;
