import { Hono } from "hono";
import { eq, and, isNull, gte, lte, sql } from "drizzle-orm";
import { createDb } from "../lib/db";
import { AppError } from "../middleware/error";
import { sessions, reconciliationLinks } from "../schema/khalis";
import { invoices, suppliers, payments, categories } from "../schema/facture";
import type { Env } from "../types/env";

const app = new Hono<{ Bindings: Env }>();

// Get Fatou's invoices for a session's date range
app.get("/:sessionId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  // Get session dates
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw new AppError(404, "Session introuvable");

  // Fetch Fatou's invoices in date range
  const dateStart = new Date(session.dateStart + "T00:00:00Z");
  const dateEnd = new Date(session.dateEnd + "T23:59:59Z");

  const rawInvoices = await db
    .select({
      id: invoices.id,
      userName: invoices.userName,
      invoiceDate: invoices.invoiceDate,
      supplierId: invoices.supplierId,
      supplierName: suppliers.name,
      category: invoices.category,
      categoryAppName: categories.appName,
      amountDisplayTTC: invoices.amountDisplayTTC,
      amountRealTTC: invoices.amountRealTTC,
      hasBrs: invoices.hasBrs,
      description: invoices.description,
      paymentType: invoices.paymentType,
      invoiceType: invoices.invoiceType,
      invoiceNumber: invoices.invoiceNumber,
      paymentStatus: invoices.paymentStatus,
      createdAt: invoices.createdAt,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .leftJoin(categories, eq(invoices.categoryId, categories.id))
    .where(
      and(
        eq(invoices.userName, "Fatou"),
        isNull(invoices.archive),
        gte(invoices.invoiceDate, dateStart),
        lte(invoices.invoiceDate, dateEnd)
      )
    )
    .orderBy(invoices.invoiceDate);

  // Get payments from facture for partial payment info
  const invoiceIds = rawInvoices.map((inv) => inv.id);
  let paymentsMap: Record<string, number> = {};

  if (invoiceIds.length > 0) {
    const allPayments = await db
      .select({
        invoiceId: payments.invoiceId,
        totalPaid: sql<string>`SUM(${payments.amountPaid})`,
      })
      .from(payments)
      .where(sql`${payments.invoiceId} IN (${sql.raw(invoiceIds.map((id) => `'${id}'`).join(","))})`)
      .groupBy(payments.invoiceId);

    for (const p of allPayments) {
      paymentsMap[p.invoiceId] = parseFloat(p.totalPaid || "0");
    }
  }

  // Get reconciliation links for this session
  let reconMap: Record<string, { waveTotal: number; cashTotal: number }> = {};

  if (invoiceIds.length > 0) {
    const allLinks = await db
      .select({
        invoiceId: reconciliationLinks.invoiceId,
        totalWave: sql<string>`SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL))`,
        totalCash: sql<string>`SUM(CAST(${reconciliationLinks.cashAmount} AS DECIMAL))`,
      })
      .from(reconciliationLinks)
      .where(
        and(
          eq(reconciliationLinks.sessionId, sessionId),
          sql`${reconciliationLinks.invoiceId} IN (${sql.raw(invoiceIds.map((id) => `'${id}'`).join(","))})`
        )
      )
      .groupBy(reconciliationLinks.invoiceId);

    for (const l of allLinks) {
      reconMap[l.invoiceId] = {
        waveTotal: parseFloat(l.totalWave || "0"),
        cashTotal: parseFloat(l.totalCash || "0"),
      };
    }
  }

  // Enrich invoices
  const enriched = rawInvoices.map((inv) => {
    const amount = parseFloat(inv.amountDisplayTTC);
    const paidInFacture = paymentsMap[inv.id] || 0;
    const remainingDue = amount - paidInFacture;
    const recon = reconMap[inv.id] || { waveTotal: 0, cashTotal: 0 };
    const reconciledTotal = recon.waveTotal + recon.cashTotal;

    let reconStatus: "done" | "partial" | "pending" = "pending";
    if (reconciledTotal > 0 && Math.abs(reconciledTotal - remainingDue) < 1) {
      reconStatus = "done";
    } else if (reconciledTotal > 0) {
      reconStatus = "partial";
    }

    return {
      ...inv,
      amount,
      paidInFacture,
      remainingDue: Math.max(0, remainingDue),
      reconciledWave: recon.waveTotal,
      reconciledCash: recon.cashTotal,
      reconciledTotal,
      reconStatus,
    };
  });

  return c.json(enriched);
});

export default app;
