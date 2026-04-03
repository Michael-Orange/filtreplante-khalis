import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql, isNull } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import { reconciliationLinks, waveTransactions } from "../schema/khalis";
import { invoices, suppliers, payments } from "../schema/facture";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

const createLinkSchema = z.object({
  sessionId: z.string().min(1),
  invoiceId: z.string().min(1),
  waveTransactionId: z.string().optional().nullable(),
  cashAmount: z.number().min(0).optional().default(0),
});

/**
 * Create reconciliation link(s).
 *
 * Wave logic: when linking a Wave to a facture, the full Wave amount is used.
 * If the Wave exceeds the invoice's remaining amount, the surplus spills over
 * to other invoices of the SAME supplier (oldest first), creating multiple links.
 */
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const { sessionId, invoiceId, waveTransactionId, cashAmount } = parsed.data;
  const db = createDb(c.env.DATABASE_URL);

  // --- Cash-only link (no wave) ---
  if (!waveTransactionId) {
    if (cashAmount <= 0) {
      throw new AppError(400, "Montant espèces requis");
    }
    const id = crypto.randomUUID();
    await db.insert(reconciliationLinks).values({
      id,
      sessionId,
      invoiceId,
      waveTransactionId: null,
      waveAmount: "0",
      cashAmount: cashAmount.toString(),
    });
    return c.json({ id, links: 1 }, 201);
  }

  // --- Wave link with auto-spill ---
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

  // Check wave is not already linked
  const [existing] = await db
    .select({ id: reconciliationLinks.id })
    .from(reconciliationLinks)
    .where(eq(reconciliationLinks.waveTransactionId, waveTransactionId));

  if (existing) {
    throw new AppError(
      400,
      "Cette transaction Wave est déjà liée à une facture."
    );
  }

  const waveTotal = parseFloat(wave.amount);

  // Get the target invoice to find its supplier
  const [targetInvoice] = await db
    .select({
      id: invoices.id,
      supplierId: invoices.supplierId,
      amountDisplayTTC: invoices.amountDisplayTTC,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));

  if (!targetInvoice) throw new AppError(404, "Facture introuvable");

  // Helper: compute remaining for an invoice (amount - paid in facture - reconciled in this session)
  async function getRemaining(invId: string, amount: number): Promise<number> {
    // Payments from facture app
    const [paidResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${payments.amountPaid} AS DECIMAL)), 0)`,
      })
      .from(payments)
      .where(eq(payments.invoiceId, invId));
    const paidInFacture = parseFloat(paidResult.total);

    // Already reconciled in this session
    const [reconResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL) + CAST(${reconciliationLinks.cashAmount} AS DECIMAL)), 0)`,
      })
      .from(reconciliationLinks)
      .where(
        and(
          eq(reconciliationLinks.sessionId, sessionId),
          eq(reconciliationLinks.invoiceId, invId)
        )
      );
    const reconTotal = parseFloat(reconResult.total);

    return Math.max(0, amount - paidInFacture - reconTotal);
  }

  // Get ALL invoices of this supplier to compute total remaining
  const supplierInvoices = await db
    .select({
      id: invoices.id,
      amountDisplayTTC: invoices.amountDisplayTTC,
      invoiceDate: invoices.invoiceDate,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.userName, "Fatou"),
        eq(invoices.supplierId, targetInvoice.supplierId),
        isNull(invoices.archive)
      )
    )
    .orderBy(invoices.invoiceDate);

  // Compute total remaining for this supplier
  let totalSupplierRemaining = 0;
  for (const inv of supplierInvoices) {
    totalSupplierRemaining += await getRemaining(inv.id, parseFloat(inv.amountDisplayTTC));
  }

  if (waveTotal > totalSupplierRemaining + 0.01) {
    const supplierName = (await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, targetInvoice.supplierId)))?.[0]?.name || "ce fournisseur";
    throw new AppError(
      400,
      `Transaction Wave (${Math.round(waveTotal)} FCFA) supérieure au total non réglé de ${supplierName} (${Math.round(totalSupplierRemaining)} FCFA). Impossible de lier.`
    );
  }

  // Get remaining for target invoice
  const targetRemaining = await getRemaining(
    targetInvoice.id,
    parseFloat(targetInvoice.amountDisplayTTC)
  );

  const createdLinks: string[] = [];
  let remaining = waveTotal;

  // Link to target invoice first
  const targetAlloc = Math.min(remaining, targetRemaining);
  if (targetAlloc > 0) {
    const id = crypto.randomUUID();
    await db.insert(reconciliationLinks).values({
      id,
      sessionId,
      invoiceId: targetInvoice.id,
      waveTransactionId,
      waveAmount: targetAlloc.toString(),
      cashAmount: "0",
    });
    createdLinks.push(id);
    remaining -= targetAlloc;
  }

  // If surplus, spill over to other invoices of the same supplier
  if (remaining > 0.01) {
    for (const inv of supplierInvoices.filter((i) => i.id !== targetInvoice.id)) {
      if (remaining <= 0.01) break;

      const invRemaining = await getRemaining(
        inv.id,
        parseFloat(inv.amountDisplayTTC)
      );
      if (invRemaining <= 0) continue;

      const alloc = Math.min(remaining, invRemaining);
      const id = crypto.randomUUID();
      await db.insert(reconciliationLinks).values({
        id,
        sessionId,
        invoiceId: inv.id,
        waveTransactionId,
        waveAmount: alloc.toString(),
        cashAmount: "0",
      });
      createdLinks.push(id);
      remaining -= alloc;
    }
  }

  return c.json(
    {
      id: createdLinks[0],
      links: createdLinks.length,
      surplus: remaining > 0.01 ? Math.round(remaining) : 0,
    },
    201
  );
});

// Get ALL reconciliation links for a session (single query)
// MUST be before /:sessionId/:invoiceId to avoid "session" being matched as sessionId
app.get("/session/:sessionId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  const links = await db
    .select({
      id: reconciliationLinks.id,
      invoiceId: reconciliationLinks.invoiceId,
      waveTransactionId: reconciliationLinks.waveTransactionId,
      waveAmount: reconciliationLinks.waveAmount,
      cashAmount: reconciliationLinks.cashAmount,
      createdAt: reconciliationLinks.createdAt,
      waveDate: waveTransactions.transactionDate,
      waveTotal: waveTransactions.amount,
      waveCounterparty: waveTransactions.counterpartyName,
    })
    .from(reconciliationLinks)
    .leftJoin(
      waveTransactions,
      eq(reconciliationLinks.waveTransactionId, waveTransactions.id)
    )
    .where(eq(reconciliationLinks.sessionId, sessionId));

  return c.json(links);
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

// Delete all links for a wave transaction (unlinking a wave removes all its spill-over links)
app.delete("/wave/:waveTransactionId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const waveTransactionId = c.req.param("waveTransactionId");

  await db
    .delete(reconciliationLinks)
    .where(eq(reconciliationLinks.waveTransactionId, waveTransactionId));

  return c.json({ success: true });
});

// Delete a single reconciliation link
app.delete("/:linkId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const linkId = c.req.param("linkId");

  await db
    .delete(reconciliationLinks)
    .where(eq(reconciliationLinks.id, linkId));

  return c.json({ success: true });
});

export default app;
