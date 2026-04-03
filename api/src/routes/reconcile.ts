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
  cashAmount: z.number().min(0).optional().default(0),
});

// Create reconciliation link
// Wave transactions are indivisible: linking a Wave always uses its full amount.
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createLinkSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "Données invalides: " + parsed.error.message);
  }

  const { sessionId, invoiceId, waveTransactionId, cashAmount } = parsed.data;

  const db = createDb(c.env.DATABASE_URL);
  let waveAmount = 0;

  // Validate wave transaction exists, belongs to session, and is not already linked
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

    // Wave is indivisible: check it's not already linked to any invoice
    const [existing] = await db
      .select({ id: reconciliationLinks.id })
      .from(reconciliationLinks)
      .where(eq(reconciliationLinks.waveTransactionId, waveTransactionId));

    if (existing) {
      throw new AppError(
        400,
        "Cette transaction Wave est déjà liée à une facture. Une transaction Wave est indivisible."
      );
    }

    waveAmount = parseFloat(wave.amount);
  }

  if (waveAmount === 0 && cashAmount === 0) {
    throw new AppError(400, "Transaction Wave ou montant espèces requis");
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
