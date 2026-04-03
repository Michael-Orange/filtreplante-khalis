import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import { reconciliationLinks, waveTransactions } from "../schema/khalis";
import { invoices, suppliers } from "../schema/facture";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

const createLinkSchema = z.object({
  sessionId: z.string().min(1),
  invoiceId: z.string().min(1),
  waveTransactionId: z.string().optional().nullable(),
  waveAmount: z.number().min(0).optional().default(0),
  cashAmount: z.number().min(0).optional().default(0),
});

// Create reconciliation link
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const { sessionId, invoiceId, waveTransactionId, waveAmount, cashAmount } =
    parsed.data;

  if (waveAmount === 0 && cashAmount === 0) {
    throw new AppError(400, "Montant Wave ou espèces requis");
  }

  const db = createDb(c.env.DATABASE_URL);

  // Validate wave transaction exists and belongs to session
  if (waveTransactionId) {
    const [wave] = await db
      .select()
      .from(waveTransactions)
      .where(
        and(
          eq(waveTransactions.id, waveTransactionId),
          eq(waveTransactions.sessionId, sessionId)
        )
      );

    if (!wave) throw new AppError(404, "Transaction Wave introuvable");

    // Check wave amount doesn't exceed remaining available on this wave
    const [waveUsed] = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL)), 0)`,
      })
      .from(reconciliationLinks)
      .where(eq(reconciliationLinks.waveTransactionId, waveTransactionId));

    const usedAmount = parseFloat(waveUsed.total);
    const waveTotal = parseFloat(wave.amount);
    if (usedAmount + waveAmount > waveTotal + 0.01) {
      throw new AppError(
        400,
        `Montant Wave trop élevé. Disponible: ${(waveTotal - usedAmount).toFixed(0)} FCFA`
      );
    }

    // Same-supplier validation: if this wave is already linked to invoices,
    // the new invoice must have the same supplier
    const existingLinks = await db
      .select({ invoiceId: reconciliationLinks.invoiceId })
      .from(reconciliationLinks)
      .where(eq(reconciliationLinks.waveTransactionId, waveTransactionId));

    if (existingLinks.length > 0) {
      // Get supplier of existing linked invoices
      const existingInvoiceId = existingLinks[0].invoiceId;
      const [existingInv] = await db
        .select({ supplierId: invoices.supplierId })
        .from(invoices)
        .where(eq(invoices.id, existingInvoiceId));

      const [newInv] = await db
        .select({ supplierId: invoices.supplierId })
        .from(invoices)
        .where(eq(invoices.id, invoiceId));

      if (
        existingInv &&
        newInv &&
        existingInv.supplierId !== newInv.supplierId
      ) {
        throw new AppError(
          400,
          "Cette transaction Wave est déjà liée à un autre fournisseur. Un virement Wave ne peut couvrir que des factures du même fournisseur."
        );
      }
    }
  }

  const id = crypto.randomUUID();
  await db.insert(reconciliationLinks).values({
    id,
    sessionId,
    invoiceId,
    waveTransactionId: waveTransactionId || null,
    waveAmount: waveAmount.toString(),
    cashAmount: cashAmount.toString(),
  });

  return c.json({ id }, 201);
});

// Get reconciliation links for an invoice in a session
app.get("/:sessionId/:invoiceId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");
  const invoiceId = c.req.param("invoiceId");

  const links = await db
    .select({
      id: reconciliationLinks.id,
      invoiceId: reconciliationLinks.invoiceId,
      waveTransactionId: reconciliationLinks.waveTransactionId,
      waveAmount: reconciliationLinks.waveAmount,
      cashAmount: reconciliationLinks.cashAmount,
      createdAt: reconciliationLinks.createdAt,
      // Wave transaction details
      waveDate: waveTransactions.transactionDate,
      waveTotal: waveTransactions.amount,
      waveCounterparty: waveTransactions.counterpartyName,
    })
    .from(reconciliationLinks)
    .leftJoin(
      waveTransactions,
      eq(reconciliationLinks.waveTransactionId, waveTransactions.id)
    )
    .where(
      and(
        eq(reconciliationLinks.sessionId, sessionId),
        eq(reconciliationLinks.invoiceId, invoiceId)
      )
    );

  return c.json(links);
});

// Delete reconciliation link
app.delete("/:linkId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const linkId = c.req.param("linkId");

  await db
    .delete(reconciliationLinks)
    .where(eq(reconciliationLinks.id, linkId));

  return c.json({ success: true });
});

export default app;
