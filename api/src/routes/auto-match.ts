import { Hono } from "hono";
import { eq, and, isNull, gte, lte, inArray, sql } from "drizzle-orm";
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

interface AutoMatchDetail {
  waveTransactionId: string;
  counterpartyName: string | null;
  amount: number;
  waveDate: string;
  status: "matched" | "ambiguous" | "unmatched";
  invoiceId?: string;
  supplierName?: string;
  invoiceNumber?: string | null;
}

/**
 * Auto-rapprochement Khalis → Facture.
 *
 * Stratégie : pour chaque wave non-RFE de la session (projectId NULL ET
 * allocations vide), non déjà lié, on cherche un candidat unique dans Facture :
 *
 *   Pool A — facture.payments (supplier_invoice, paymentType ILIKE '%Wave%')
 *   Pool B — facture.invoices  (invoiceType='expense', paymentType ILIKE '%Wave%')
 *
 * Critères : montant exact (±0,01) ET date ±1 jour.
 *   0 candidat  → wave laissé manuel (status "unmatched")
 *   1 candidat  → lien créé (status "matched")
 *   ≥2 candidats → wave laissé manuel (status "ambiguous")
 *
 * Multiset : une ligne de paiement / dépense déjà consommée par un
 * reconciliation_link existant (toutes sessions confondues) est filtrée via
 * soustraction multiset sur les `waveAmount` déjà liés par facture. Empêche
 * un double-match si Fatou avait déjà rapproché manuellement.
 *
 * Les waves avec liens partiels préexistants sont ignorés (spill-over manuel
 * rare, on laisse Fatou finir à la main).
 *
 * Les insertions sont atomiques dans une transaction unique (cohérent avec
 * reconcile.ts). Idempotent : re-cliquer ne crée pas de doublons.
 */
app.post("/:sessionId", async (c) => {
  const db = createDb(c.env.DATABASE_URL);
  const sessionId = c.req.param("sessionId");

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  if (!session) throw new AppError(404, "Session introuvable");

  // Extension ±1j pour absorber les paiements saisis en bord de session
  const extStart = shiftDay(session.dateStart, -1);
  const extEnd = shiftDay(session.dateEnd, 1);

  // --- Étape 1 : charger les waves candidats (non-RFE, non déjà liés) ---
  const allWaves = await db
    .select({
      id: waveTransactions.id,
      transactionDate: waveTransactions.transactionDate,
      amount: waveTransactions.amount,
      counterpartyName: waveTransactions.counterpartyName,
      projectId: waveTransactions.projectId,
      allocations: waveTransactions.allocations,
    })
    .from(waveTransactions)
    .where(eq(waveTransactions.sessionId, sessionId));

  // Sommes déjà liées par wave (session courante)
  const waveLinkRows = await db
    .select({
      waveTransactionId: reconciliationLinks.waveTransactionId,
      total: sql<string>`COALESCE(SUM(CAST(${reconciliationLinks.waveAmount} AS DECIMAL)), 0)`,
    })
    .from(reconciliationLinks)
    .where(eq(reconciliationLinks.sessionId, sessionId))
    .groupBy(reconciliationLinks.waveTransactionId);

  const waveUsed = new Map<string, number>();
  for (const r of waveLinkRows) {
    if (r.waveTransactionId) waveUsed.set(r.waveTransactionId, parseFloat(r.total));
  }

  const candidateWaves = allWaves
    .filter((w) => {
      const hasAllocs = Array.isArray(w.allocations) && w.allocations.length > 0;
      if (w.projectId || hasAllocs) return false; // RFE → skip
      if ((waveUsed.get(w.id) || 0) > 0.01) return false; // déjà lié (même partiellement)
      return true;
    })
    .map((w) => ({
      id: w.id,
      transactionDate: w.transactionDate,
      amount: parseFloat(w.amount),
      counterpartyName: w.counterpartyName,
    }))
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  if (candidateWaves.length === 0) {
    return c.json({
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      totalCandidates: 0,
      details: [] as AutoMatchDetail[],
    });
  }

  // --- Étape 2a : Pool A — paiements supplier_invoice avec paymentType Wave ---
  // Utilisation de `sql` raw pour le filtre ILIKE — certains opérateurs
  // Drizzle se comportent de manière inattendue avec neon-serverless.
  const poolARows = await db
    .select({
      paymentId: payments.id,
      invoiceId: payments.invoiceId,
      amountPaid: payments.amountPaid,
      paymentDate: payments.paymentDate,
      supplierName: suppliers.name,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(
      and(
        eq(invoices.userName, "Fatou"),
        isNull(invoices.archive),
        eq(invoices.invoiceType, "supplier_invoice"),
        sql`${payments.paymentType} ILIKE '%Wave%'`,
        gte(payments.paymentDate, extStart),
        lte(payments.paymentDate, extEnd),
      ),
    );

  // --- Étape 2b : Pool B — dépenses one-shot Wave ---
  const extStartDate = new Date(extStart + "T00:00:00Z");
  const extEndDate = new Date(extEnd + "T23:59:59Z");
  const poolBRows = await db
    .select({
      invoiceId: invoices.id,
      amountDisplayTTC: invoices.amountDisplayTTC,
      invoiceDate: invoices.invoiceDate,
      paymentType: invoices.paymentType,
      supplierName: suppliers.name,
      invoiceNumber: invoices.invoiceNumber,
    })
    .from(invoices)
    .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
    .where(
      and(
        eq(invoices.userName, "Fatou"),
        isNull(invoices.archive),
        eq(invoices.invoiceType, "expense"),
        sql`${invoices.paymentType} ILIKE '%Wave%'`,
        gte(invoices.invoiceDate, extStartDate),
        lte(invoices.invoiceDate, extEndDate),
      ),
    );

  // --- Étape 3 : construire le multiset des montants Wave déjà liés ---
  // On balaye toutes les sessions (pas seulement la courante), car une
  // facture peut avoir été rapprochée dans une session précédente.
  const candidateInvoiceIds = new Set<string>();
  for (const p of poolARows) candidateInvoiceIds.add(p.invoiceId);
  for (const b of poolBRows) candidateInvoiceIds.add(b.invoiceId);

  const consumedByInvoice = new Map<string, number[]>();
  if (candidateInvoiceIds.size > 0) {
    const linkRows = await db
      .select({
        invoiceId: reconciliationLinks.invoiceId,
        waveAmount: reconciliationLinks.waveAmount,
      })
      .from(reconciliationLinks)
      .where(
        and(
          inArray(
            reconciliationLinks.invoiceId,
            Array.from(candidateInvoiceIds),
          ),
          sql`${reconciliationLinks.waveTransactionId} IS NOT NULL`,
        ),
      );
    for (const l of linkRows) {
      const v = parseFloat(l.waveAmount);
      if (v <= 0.01) continue;
      const arr = consumedByInvoice.get(l.invoiceId);
      if (arr) arr.push(v);
      else consumedByInvoice.set(l.invoiceId, [v]);
    }
  }

  // --- Étape 3b : filtrer les pools par soustraction multiset ---
  // Tri pool A par date croissante pour un résultat déterministe.
  poolARows.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

  type Candidate = {
    kind: "payment" | "expense";
    invoiceId: string;
    amount: number;
    date: string; // YYYY-MM-DD
    supplierName: string | null;
    invoiceNumber: string | null;
  };

  // Copie de travail du multiset
  const consumedWorking = new Map<string, number[]>();
  for (const [k, v] of consumedByInvoice) consumedWorking.set(k, [...v]);

  const tryConsume = (invoiceId: string, amount: number): boolean => {
    const arr = consumedWorking.get(invoiceId);
    if (!arr || arr.length === 0) return false;
    const idx = arr.findIndex((v) => Math.abs(v - amount) <= 0.01);
    if (idx === -1) return false;
    arr.splice(idx, 1);
    return true;
  };

  const availableCandidates: Candidate[] = [];

  for (const p of poolARows) {
    const amt = parseFloat(p.amountPaid);
    if (tryConsume(p.invoiceId, amt)) continue; // déjà lié
    availableCandidates.push({
      kind: "payment",
      invoiceId: p.invoiceId,
      amount: amt,
      date: p.paymentDate,
      supplierName: p.supplierName ?? null,
      invoiceNumber: p.invoiceNumber ?? null,
    });
  }
  for (const b of poolBRows) {
    const amt = parseFloat(b.amountDisplayTTC);
    if (tryConsume(b.invoiceId, amt)) continue;
    availableCandidates.push({
      kind: "expense",
      invoiceId: b.invoiceId,
      amount: amt,
      date: b.invoiceDate.toISOString().slice(0, 10),
      supplierName: b.supplierName ?? null,
      invoiceNumber: b.invoiceNumber ?? null,
    });
  }

  // --- Étape 4 : matcher chaque wave ---
  const DAY_MS = 86_400_000;
  const toleranceMs = DAY_MS + 60_000; // ±1j avec marge de 1min pour l'arrondi horaire

  // Candidats consommés pendant CE run (évite qu'un même paiement soit réclamé
  // par deux waves du même lot à montant+date identiques).
  const usedInRun = new Set<string>();
  const keyOf = (c: Candidate) =>
    `${c.kind}|${c.invoiceId}|${c.amount.toFixed(2)}|${c.date}`;

  const toInsert: {
    id: string;
    sessionId: string;
    invoiceId: string;
    waveTransactionId: string;
    waveAmount: string;
    cashAmount: string;
  }[] = [];
  const details: AutoMatchDetail[] = [];

  for (const wave of candidateWaves) {
    const waveMs = new Date(wave.transactionDate + "T12:00:00Z").getTime();

    const matching = availableCandidates.filter((cand) => {
      if (usedInRun.has(keyOf(cand))) return false;
      if (Math.abs(cand.amount - wave.amount) > 0.01) return false;
      const candMs = new Date(cand.date + "T12:00:00Z").getTime();
      return Math.abs(candMs - waveMs) <= toleranceMs;
    });

    if (matching.length === 0) {
      details.push({
        waveTransactionId: wave.id,
        counterpartyName: wave.counterpartyName,
        amount: wave.amount,
        waveDate: wave.transactionDate,
        status: "unmatched",
      });
      continue;
    }

    if (matching.length >= 2) {
      details.push({
        waveTransactionId: wave.id,
        counterpartyName: wave.counterpartyName,
        amount: wave.amount,
        waveDate: wave.transactionDate,
        status: "ambiguous",
      });
      continue;
    }

    const chosen = matching[0];
    usedInRun.add(keyOf(chosen));
    toInsert.push({
      id: crypto.randomUUID(),
      sessionId,
      invoiceId: chosen.invoiceId,
      waveTransactionId: wave.id,
      waveAmount: wave.amount.toString(),
      cashAmount: "0",
    });
    details.push({
      waveTransactionId: wave.id,
      counterpartyName: wave.counterpartyName,
      amount: wave.amount,
      waveDate: wave.transactionDate,
      status: "matched",
      invoiceId: chosen.invoiceId,
      supplierName: chosen.supplierName ?? undefined,
      invoiceNumber: chosen.invoiceNumber ?? undefined,
    });
  }

  // --- Étape 5 : insertion atomique + rapport ---
  if (toInsert.length > 0) {
    await db.transaction(async (tx) => {
      await tx.insert(reconciliationLinks).values(toInsert);
    });
  }

  const matched = details.filter((d) => d.status === "matched").length;
  const ambiguous = details.filter((d) => d.status === "ambiguous").length;
  const unmatched = details.filter((d) => d.status === "unmatched").length;

  return c.json({
    matched,
    ambiguous,
    unmatched,
    totalCandidates: candidateWaves.length,
    // Diagnostic — tailles des pools et exemples pour debug
    diag: {
      totalWaves: allWaves.length,
      candidateWaves: candidateWaves.length,
      poolASize: poolARows.length,
      poolBSize: poolBRows.length,
      availableCandidates: availableCandidates.length,
      poolBSample: poolBRows.slice(0, 3).map((b) => ({
        invoiceId: b.invoiceId,
        amount: parseFloat(b.amountDisplayTTC),
        date: b.invoiceDate.toISOString().slice(0, 10),
        supplierName: b.supplierName,
        paymentType: b.paymentType,
      })),
      extStart,
      extEnd,
    },
    details,
  });
});

function shiftDay(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default app;
