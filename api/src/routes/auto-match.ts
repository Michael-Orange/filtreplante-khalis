import { Hono } from "hono";
import { eq, and, isNull, gte, lte, sql, inArray } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import {
  sessions,
  waveTransactions,
  reconciliationLinks,
} from "../schema/khalis";
import { invoices, suppliers, payments } from "../schema/facture";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

interface Suggestion {
  invoiceId: string;
  waveTransactionId: string;
  invoiceAmount: number;
  waveAmount: number;
  supplierName: string;
  counterpartyName: string | null;
  invoiceDate: string;
  waveDate: string;
  confidence: "high" | "medium";
}

// Generate auto-match suggestions
app.post("/:sessionId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw new AppError(404, "Session introuvable");

  const dateStart = new Date(session.dateStart + "T00:00:00Z");
  const dateEnd = new Date(session.dateEnd + "T23:59:59Z");

  // Get Fatou's invoices with Wave payment types that are not yet reconciled
  const fatouInvoices = await db
    .select({
      id: invoices.id,
      invoiceDate: invoices.invoiceDate,
      supplierId: invoices.supplierId,
      supplierName: suppliers.name,
      amountDisplayTTC: invoices.amountDisplayTTC,
      paymentType: invoices.paymentType,
      paymentStatus: invoices.paymentStatus,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(
      and(
        eq(invoices.userName, "Fatou"),
        isNull(invoices.archive),
        gte(invoices.invoiceDate, dateStart),
        lte(invoices.invoiceDate, dateEnd)
      )
    );

  // Get payments from facture for remaining amount calc
  const invoiceIds = fatouInvoices.map((inv) => inv.id);
  const paymentsMap: Record<string, number> = {};
  if (invoiceIds.length > 0) {
    const allPayments = await db
      .select({
        invoiceId: payments.invoiceId,
        totalPaid: sql<string>`SUM(${payments.amountPaid})`,
      })
      .from(payments)
      .where(inArray(payments.invoiceId, invoiceIds))
      .groupBy(payments.invoiceId);

    for (const p of allPayments) {
      paymentsMap[p.invoiceId] = parseFloat(p.totalPaid || "0");
    }
  }

  // Get already reconciled amounts in this session
  const reconMap: Record<string, number> = {};
  if (invoiceIds.length > 0) {
    const existingRecons = await db
      .select({
        invoiceId: reconciliationLinks.invoiceId,
        total: sql<string>`SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL) + CAST(${reconciliationLinks.cashAmount} AS DECIMAL))`,
      })
      .from(reconciliationLinks)
      .where(
        and(
          eq(reconciliationLinks.sessionId, sessionId),
          inArray(reconciliationLinks.invoiceId, invoiceIds),
        ),
      )
      .groupBy(reconciliationLinks.invoiceId);

    for (const r of existingRecons) {
      reconMap[r.invoiceId] = parseFloat(r.total || "0");
    }
  }

  // Get unmatched wave transactions
  const allWaves = await db
    .select({
      id: waveTransactions.id,
      transactionDate: waveTransactions.transactionDate,
      amount: waveTransactions.amount,
      counterpartyName: waveTransactions.counterpartyName,
    })
    .from(waveTransactions)
    .where(eq(waveTransactions.sessionId, sessionId));

  // Calculate remaining on each wave
  const waveUsedMap: Record<string, number> = {};
  const waveLinks = await db
    .select({
      waveTransactionId: reconciliationLinks.waveTransactionId,
      total: sql<string>`SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL))`,
    })
    .from(reconciliationLinks)
    .where(eq(reconciliationLinks.sessionId, sessionId))
    .groupBy(reconciliationLinks.waveTransactionId);

  for (const wl of waveLinks) {
    if (wl.waveTransactionId) {
      waveUsedMap[wl.waveTransactionId] = parseFloat(wl.total || "0");
    }
  }

  const availableWaves = allWaves
    .map((w) => ({
      ...w,
      amountNum: parseFloat(w.amount),
      remaining: parseFloat(w.amount) - (waveUsedMap[w.id] || 0),
    }))
    .filter((w) => w.remaining > 0.01);

  // Match: Wave payment invoices with exact amount + close date
  const suggestions: Suggestion[] = [];
  const usedWaveIds = new Set<string>();
  const usedInvoiceIds = new Set<string>();

  for (const inv of fatouInvoices) {
    if (!inv.paymentType?.includes("Wave")) continue;

    const amount = parseFloat(inv.amountDisplayTTC);
    const paidInFacture = paymentsMap[inv.id] || 0;
    const reconciledInSession = reconMap[inv.id] || 0;
    const remaining = amount - paidInFacture - reconciledInSession;

    if (remaining < 1) continue; // Already fully reconciled

    const invDate = new Date(inv.invoiceDate);

    for (const wave of availableWaves) {
      if (usedWaveIds.has(wave.id)) continue;

      // Exact amount match (within 1 FCFA tolerance)
      if (Math.abs(wave.remaining - remaining) > 1) continue;

      // Date proximity: within 5 days
      const waveDate = new Date(wave.transactionDate + "T00:00:00Z");
      const daysDiff = Math.abs(
        (invDate.getTime() - waveDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysDiff > 5) continue;

      const confidence = daysDiff <= 1 ? "high" : "medium";

      suggestions.push({
        invoiceId: inv.id,
        waveTransactionId: wave.id,
        invoiceAmount: remaining,
        waveAmount: wave.remaining,
        supplierName: inv.supplierName || "Inconnu",
        counterpartyName: wave.counterpartyName,
        invoiceDate: inv.invoiceDate.toISOString().split("T")[0],
        waveDate: wave.transactionDate,
        confidence,
      });

      usedWaveIds.add(wave.id);
      usedInvoiceIds.add(inv.id);
      break; // One suggestion per invoice
    }
  }

  // Sort by confidence
  suggestions.sort((a, b) => {
    if (a.confidence === "high" && b.confidence !== "high") return -1;
    if (b.confidence === "high" && a.confidence !== "high") return 1;
    return 0;
  });

  return c.json({ suggestions });
});

export default app;
