import { Hono } from "hono";
import { z } from "zod";
import { eq, and, sql, isNull, gte, lte, inArray } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import { reconciliationLinks, waveTransactions, sessions } from "../schema/khalis";
import { invoices, suppliers, payments } from "../schema/facture";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

const createLinkSchema = z.object({
  sessionId: z.string().min(1).max(100),
  invoiceId: z.string().min(1).max(100),
  waveTransactionId: z.string().max(100).optional().nullable(),
  cashAmount: z.number().min(0).max(1_000_000_000).optional().default(0),
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

  // --- Wave link avec spill-over, atomique ---
  // Tout est dans une transaction pour éviter les races : deux rapprochements
  // concurrents ne peuvent plus sur-allouer la même facture, car la
  // transaction isole les reads de reconciliation_links et les writes.
  const result = await db.transaction(async (tx) => {
    const [wave] = await tx
      .select()
      .from(waveTransactions)
      .where(
        and(
          eq(waveTransactions.id, waveTransactionId),
          eq(waveTransactions.sessionId, sessionId),
        ),
      );
    if (!wave) throw new AppError(404, "Transaction Wave introuvable");

    const [existing] = await tx
      .select({ id: reconciliationLinks.id })
      .from(reconciliationLinks)
      .where(eq(reconciliationLinks.waveTransactionId, waveTransactionId));
    if (existing) {
      throw new AppError(
        400,
        "Cette transaction Wave est déjà liée à une facture.",
      );
    }

    const waveTotal = parseFloat(wave.amount);

    const [session] = await tx
      .select({ dateStart: sessions.dateStart, dateEnd: sessions.dateEnd })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    if (!session) throw new AppError(404, "Session introuvable");

    const dateStart = new Date(session.dateStart + "T00:00:00Z");
    const dateEnd = new Date(session.dateEnd + "T23:59:59Z");

    const [targetInvoice] = await tx
      .select({
        id: invoices.id,
        supplierId: invoices.supplierId,
        amountDisplayTTC: invoices.amountDisplayTTC,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    if (!targetInvoice) throw new AppError(404, "Facture introuvable");

    // Charge toutes les factures du même fournisseur dans la période
    const supplierInvoices = await tx
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
          isNull(invoices.archive),
          gte(invoices.invoiceDate, dateStart),
          lte(invoices.invoiceDate, dateEnd),
        ),
      )
      .orderBy(invoices.invoiceDate);

    // Pré-calcul de tous les "remaining" en 2 requêtes groupBy, pas N round-trips
    const supplierIds = supplierInvoices.map((i) => i.id);
    const paidMap = new Map<string, number>();
    const reconMap = new Map<string, number>();

    if (supplierIds.length > 0) {
      const paidRows = await tx
        .select({
          invoiceId: payments.invoiceId,
          total: sql<string>`COALESCE(SUM(CAST(${payments.amountPaid} AS DECIMAL)), 0)`,
        })
        .from(payments)
        .where(inArray(payments.invoiceId, supplierIds))
        .groupBy(payments.invoiceId);
      for (const p of paidRows) paidMap.set(p.invoiceId, parseFloat(p.total));

      const reconRows = await tx
        .select({
          invoiceId: reconciliationLinks.invoiceId,
          total: sql<string>`COALESCE(SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL) + CAST(${reconciliationLinks.cashAmount} AS DECIMAL)), 0)`,
        })
        .from(reconciliationLinks)
        .where(
          and(
            eq(reconciliationLinks.sessionId, sessionId),
            inArray(reconciliationLinks.invoiceId, supplierIds),
          ),
        )
        .groupBy(reconciliationLinks.invoiceId);
      for (const r of reconRows) reconMap.set(r.invoiceId, parseFloat(r.total));
    }

    const remainingOf = (invId: string, amount: number) =>
      Math.max(0, amount - (paidMap.get(invId) || 0) - (reconMap.get(invId) || 0));

    const totalSupplierRemaining = supplierInvoices.reduce(
      (s, inv) => s + remainingOf(inv.id, parseFloat(inv.amountDisplayTTC)),
      0,
    );

    if (waveTotal > totalSupplierRemaining + 0.01) {
      throw new AppError(
        400,
        `Transaction Wave (${Math.round(waveTotal)} FCFA) supérieure au montant non réglé de la période (${Math.round(totalSupplierRemaining)} FCFA).`,
      );
    }

    const targetRemaining = remainingOf(
      targetInvoice.id,
      parseFloat(targetInvoice.amountDisplayTTC),
    );

    const createdLinks: string[] = [];
    let remaining = waveTotal;

    // Cible en premier
    const targetAlloc = Math.min(remaining, targetRemaining);
    if (targetAlloc > 0) {
      const id = crypto.randomUUID();
      await tx.insert(reconciliationLinks).values({
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

    // Spill-over sur les autres factures du même fournisseur (ordre : plus anciennes d'abord)
    if (remaining > 0.01) {
      for (const inv of supplierInvoices) {
        if (inv.id === targetInvoice.id) continue;
        if (remaining <= 0.01) break;
        const invRemaining = remainingOf(inv.id, parseFloat(inv.amountDisplayTTC));
        if (invRemaining <= 0) continue;
        const alloc = Math.min(remaining, invRemaining);
        const id = crypto.randomUUID();
        await tx.insert(reconciliationLinks).values({
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

    return {
      id: createdLinks[0],
      links: createdLinks.length,
      surplus: remaining > 0.01 ? Math.round(remaining) : 0,
    };
  });

  return c.json(result, 201);
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
      // Invoice details
      invoiceAmount: invoices.amountDisplayTTC,
      invoiceDate: invoices.invoiceDate,
      invoiceDescription: invoices.description,
      invoicePaymentType: invoices.paymentType,
      supplierName: suppliers.name,
    })
    .from(reconciliationLinks)
    .leftJoin(
      waveTransactions,
      eq(reconciliationLinks.waveTransactionId, waveTransactions.id)
    )
    .leftJoin(invoices, eq(reconciliationLinks.invoiceId, invoices.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
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

  const deleted = await db
    .delete(reconciliationLinks)
    .where(eq(reconciliationLinks.waveTransactionId, waveTransactionId))
    .returning({ id: reconciliationLinks.id });

  return c.json({ success: true, deleted: deleted.length });
});

// Delete a single reconciliation link
app.delete("/:linkId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const linkId = c.req.param("linkId");

  const deleted = await db
    .delete(reconciliationLinks)
    .where(eq(reconciliationLinks.id, linkId))
    .returning({ id: reconciliationLinks.id });

  if (deleted.length === 0) {
    throw new AppError(404, "Lien de rapprochement introuvable");
  }

  return c.json({ success: true, deleted: deleted.length });
});

export default app;
