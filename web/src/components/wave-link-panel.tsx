import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, getErrorMessage } from "../lib/api";
import { formatCFA, formatDate, formatDateShort } from "../lib/format";
import { useToast } from "../lib/toast";
import type {
  WaveTransaction,
  InvoiceRow,
  ReconciliationLink,
  WaveLinkEntry,
} from "../types/khalis";

// ─── Wave Link Panel (right side) ─────────────────────────────────

export function WaveLinkPanel({
  wave,
  sessionId,
  invoices,
  links,
  allLinks,
  onBack,
  onChanged,
}: {
  wave: WaveTransaction;
  sessionId: string;
  invoices: InvoiceRow[];
  links: WaveLinkEntry[];
  allLinks: ReconciliationLink[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const waveAmount = parseFloat(wave.amount);
  const totalAllocated = links.reduce((s, l) => s + l.waveAmount, 0);
  const isLinked = links.length > 0;
  const surplus = waveAmount - totalAllocated;

  // Wave flagué RFE (Règlement facture d'équipe) = a des allocations chevron.
  // Ces waves ne se rapprochent PAS avec les factures fournisseurs classiques —
  // leur liaison est gérée dans l'onglet "Résumé dépenses" via l'auto-link.
  const isRFE = !!wave.allocations && wave.allocations.length > 0;

  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  const { toast } = useToast();

  const linkMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      api.post("/api/reconcile", {
        sessionId,
        invoiceId,
        waveTransactionId: wave.id,
        cashAmount: 0,
      }),
    onMutate: (invoiceId) => setPendingInvoiceId(invoiceId),
    onSuccess: () => {
      setPendingInvoiceId(null);
      toast("✓ Lié");
      onChanged();
    },
    onError: (err) => {
      setPendingInvoiceId(null);
      toast(getErrorMessage(err), "error");
    },
  });

  // Unlink ALL links for this wave (cascade)
  const unlinkMutation = useMutation({
    mutationFn: () => api.delete(`/api/reconcile/wave/${wave.id}`),
    onSuccess: () => {
      toast("✓ Délié");
      onChanged();
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

  // Unlink a single link by ID
  const unlinkSingleMutation = useMutation({
    mutationFn: (linkId: string) => api.delete(`/api/reconcile/${linkId}`),
    onSuccess: () => {
      toast("✓ Délié");
      onChanged();
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

  // Build a map: invoiceId -> linkIds for this session (to enable per-invoice unlink)
  const invoiceToLinkIds = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const link of allLinks) {
      if (!map[link.invoiceId]) map[link.invoiceId] = [];
      map[link.invoiceId].push(link.id);
    }
    return map;
  }, [allLinks]);

  const showLinked = isLinked || pendingInvoiceId;

  // Group ALL invoices by supplier. Hide supplier only when ALL its invoices are done.
  const groupedInvoices = useMemo(() => {
    const groups: Record<string, { supplierName: string; invoices: InvoiceRow[]; hasPartial: boolean; allDone: boolean }> = {};

    for (const inv of invoices) {
      const key = inv.supplierId || "unknown";
      if (!groups[key]) {
        groups[key] = { supplierName: inv.supplierName || "—", invoices: [], hasPartial: false, allDone: true };
      }
      groups[key].invoices.push(inv);
      if (inv.reconStatus === "partial") groups[key].hasPartial = true;
      if (inv.reconStatus !== "done") groups[key].allDone = false;
    }

    // All groups visible. allDone groups at the bottom.
    return Object.values(groups)
      .sort((a, b) => {
        // allDone groups go to the bottom
        if (a.allDone && !b.allDone) return 1;
        if (!a.allDone && b.allDone) return -1;
        // Among non-done: partial first, then by closest amount
        if (a.hasPartial && !b.hasPartial) return -1;
        if (!a.hasPartial && b.hasPartial) return 1;
        const pendingA = a.invoices.filter((i) => i.reconStatus !== "done");
        const pendingB = b.invoices.filter((i) => i.reconStatus !== "done");
        if (pendingA.length === 0 || pendingB.length === 0) return 0;
        const bestA = Math.min(...pendingA.map((inv) => Math.abs((inv.remainingDue - inv.reconciledTotal) - waveAmount)));
        const bestB = Math.min(...pendingB.map((inv) => Math.abs((inv.remainingDue - inv.reconciledTotal) - waveAmount)));
        return bestA - bestB;
      });
  }, [invoices, waveAmount]);

  return (
    <div className="flex flex-col h-full">
      {/* Wave header */}
      <div className="bg-white border-b px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={onBack}
            className="lg:hidden text-gray-400 hover:text-gray-600"
            aria-label="Retour à la liste"
          >
            &larr;
          </button>
          <h3 className="font-heading font-semibold text-gray-900">{formatCFA(waveAmount)}</h3>
        </div>
        <div className="text-sm text-gray-500">
          <div>{formatDate(wave.transactionDate)}</div>
          {wave.counterpartyName && <div className="mt-0.5">Bénéficiaire : {wave.counterpartyName}</div>}
          {wave.counterpartyMobile && <div className="text-xs text-gray-400">{wave.counterpartyMobile}</div>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Linked invoices */}
        {isLinked && (
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-gray-500 uppercase">
                Facture{links.length > 1 ? "s" : ""} liée{links.length > 1 ? "s" : ""} ({links.length})
              </h4>
              <button
                onClick={() => unlinkMutation.mutate()}
                disabled={unlinkMutation.isPending}
                className="text-red-400 hover:text-red-600 text-xs font-medium"
              >
                Tout délier
              </button>
            </div>
            <div className="space-y-1.5">
              {links.map((link) => (
                <div key={link.linkId} className="bg-green-50 rounded-lg px-3 py-2 text-sm">
                  <div className="text-green-700 font-medium">
                    {link.supplierName || "—"} · {formatCFA(link.waveAmount)}
                    {link.invoiceAmount && (
                      <span className="font-normal text-green-500 ml-1">
                        (facture: {formatCFA(parseFloat(link.invoiceAmount))})
                      </span>
                    )}
                  </div>
                  <div className="text-green-500 text-xs">
                    {link.invoiceDate ? formatDateShort(link.invoiceDate) : ""} · {link.invoiceDescription?.slice(0, 50) || ""}
                  </div>
                </div>
              ))}
            </div>
            {surplus > 1 && (
              <div className="mt-2 text-xs text-orange-600 font-medium">
                Surplus non affecté : {formatCFA(surplus)}
              </div>
            )}
            {surplus <= 1 && (
              <div className="mt-3 text-center">
                <div className="text-green-500 text-2xl mb-1">✓</div>
                <p className="text-green-700 text-sm font-medium">Transaction entièrement affectée</p>
              </div>
            )}
          </div>
        )}

        {/* Optimistic pending */}
        {pendingInvoiceId && !isLinked && (
          <div className="px-4 py-3 border-b">
            <div className="bg-green-50/60 rounded-lg px-3 py-2 text-sm text-green-600">
              Enregistrement...
            </div>
          </div>
        )}

        {/* Error message */}
        {linkMutation.isError && (
          <div className="px-4 py-2 bg-red-50 border-b">
            <p className="text-red-600 text-sm">{getErrorMessage(linkMutation.error) || "Erreur"}</p>
          </div>
        )}

        {/* Available invoices grouped by supplier — masqué si wave RFE */}
        {!showLinked && isRFE && (
          <div className="px-4 py-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <div className="flex items-start gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-amber-600 flex-shrink-0 mt-0.5"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Règlement facture d'équipe</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Ce règlement est flaggé "Règlement facture d'équipe" (projet + répartition par personne). La liaison avec les factures d'équipe est calculée automatiquement dans l'onglet <strong>Résumé dépenses</strong>.
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    Pour rapprocher ce règlement avec une facture fournisseur classique, retire d'abord sa répartition RFE via le chevron à gauche.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        {!showLinked && !isRFE && (
          <div className="px-4 py-3">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Factures disponibles</h4>
            <p className="text-xs text-gray-400 mb-3">
              Le paiement Wave sera automatiquement réparti sur les factures du même fournisseur si le montant dépasse.
            </p>
            {groupedInvoices.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune facture à rapprocher</p>
            ) : (
              <div className="space-y-3">
                {groupedInvoices.map((group) => (
                  <SupplierGroup
                    key={group.supplierName}
                    group={group}
                    waveAmount={waveAmount}
                    sessionId={sessionId}
                    allLinks={allLinks}
                    invoiceToLinkIds={invoiceToLinkIds}
                    onLink={(invId) => linkMutation.mutate(invId)}
                    onUnlinkInvoice={(linkIds) => linkIds.forEach((id) => unlinkSingleMutation.mutate(id))}
                    onChanged={onChanged}
                    linkPending={linkMutation.isPending}
                    unlinkPending={unlinkSingleMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Supplier Group (invoices grouped by supplier with cash input) ──
// Composant interne utilisé seulement par WaveLinkPanel.

function SupplierGroup({
  group,
  waveAmount,
  sessionId,
  allLinks,
  invoiceToLinkIds,
  onLink,
  onUnlinkInvoice,
  onChanged,
  linkPending,
  unlinkPending,
}: {
  group: { supplierName: string; invoices: InvoiceRow[]; hasPartial: boolean; allDone: boolean };
  waveAmount: number;
  sessionId: string;
  allLinks: ReconciliationLink[];
  invoiceToLinkIds: Record<string, string[]>;
  onLink: (invoiceId: string) => void;
  onUnlinkInvoice: (linkIds: string[]) => void;
  onChanged: () => void;
  linkPending: boolean;
  unlinkPending: boolean;
}) {
  // `waveAmount` utilisé dans le classement de groupes côté parent (dépendance
  // du useMemo). Non lu ici mais gardé dans la signature pour la cohérence.
  void waveAmount;
  const [cashInvoiceId, setCashInvoiceId] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState("");
  const { toast } = useToast();

  const cashMutation = useMutation({
    mutationFn: (data: { invoiceId: string; amount: number }) =>
      api.post("/api/reconcile", {
        sessionId,
        invoiceId: data.invoiceId,
        cashAmount: data.amount,
      }),
    onSuccess: () => {
      setCashInvoiceId(null);
      setCashAmount("");
      toast("✓ Réglé en espèces");
      onChanged();
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

  const handleAddCash = (invoiceId: string) => {
    const amount = parseInt(cashAmount) || 0;
    if (amount <= 0) return;
    cashMutation.mutate({ invoiceId, amount });
  };

  return (
    <div className={`rounded-lg border ${group.allDone ? "border-green-200 opacity-50" : group.hasPartial ? "border-orange-200" : "border-gray-200"}`}>
      <div className={`px-3 py-2 text-sm font-medium rounded-t-lg flex items-center justify-between ${group.allDone ? "bg-green-50 text-green-700" : group.hasPartial ? "bg-orange-50 text-orange-800" : "bg-gray-50 text-gray-700"}`}>
        <div>
          {group.supplierName}
          <span className="text-xs font-normal ml-2 opacity-70">
            ({group.invoices.length} facture{group.invoices.length > 1 ? "s" : ""})
          </span>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {group.invoices
          .slice()
          .sort((a, b) => {
            const order = { partial: 0, pending: 1, done: 2 };
            const diff = order[a.reconStatus] - order[b.reconStatus];
            if (diff !== 0) return diff;
            return new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime();
          })
          .map((inv) => {
            const remaining = inv.remainingDue - inv.reconciledTotal;
            const diff = Math.abs(remaining - waveAmount);
            const isExactMatch = diff < 1 && inv.reconStatus !== "done";
            const isPartial = inv.reconStatus === "partial";
            const isDone = inv.reconStatus === "done";

            return (
              <div key={inv.id}>
                <div
                  className={`flex items-center justify-between py-2 px-3 ${
                    isDone
                      ? "bg-green-50/30 opacity-60"
                      : isPartial
                      ? "bg-orange-50/50"
                      : isExactMatch
                      ? "bg-green-50/50"
                      : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${isDone ? "text-green-600 line-through" : "text-gray-900"}`}>
                        {formatCFA(inv.amount)}
                      </span>
                      {isDone && (
                        <span className="text-xs bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-medium">
                          Rapproché
                        </span>
                      )}
                      {isPartial && (
                        <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-medium">
                          Reste {formatCFA(remaining)}
                        </span>
                      )}
                      {isExactMatch && !isPartial && (
                        <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-medium">
                          Montant exact
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {formatDateShort(inv.invoiceDate)} · {inv.description?.slice(0, 40) || inv.paymentType}
                    </div>
                    {/* Payment detail for done/partial invoices */}
                    {(isDone || isPartial) && (() => {
                      const invLinks = allLinks.filter((l) => l.invoiceId === inv.id);
                      if (invLinks.length === 0) return null;
                      return (
                        <div className="mt-1 space-y-0.5">
                          {invLinks.map((l) => (
                            <div key={l.id} className="text-xs">
                              {parseFloat(l.waveAmount) > 0 && (
                                <span className="text-blue-600">
                                  Wave {formatCFA(parseFloat(l.waveAmount))}
                                  {l.waveDate && <span className="opacity-70"> · {formatDateShort(l.waveDate)}</span>}
                                  {l.waveCounterparty && <span className="opacity-70"> · {l.waveCounterparty}</span>}
                                </span>
                              )}
                              {parseFloat(l.cashAmount) > 0 && (
                                <span className="text-amber-600">
                                  Espèces {formatCFA(parseFloat(l.cashAmount))}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    {!isDone && (
                      <button
                        onClick={() => onLink(inv.id)}
                        disabled={linkPending}
                        className="text-xs text-pine font-medium hover:text-pine-hover whitespace-nowrap"
                      >
                        Lier
                      </button>
                    )}
                    {!isDone && remaining > 0 && (
                      <button
                        onClick={() => setCashInvoiceId(cashInvoiceId === inv.id ? null : inv.id)}
                        className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap"
                        title="Ajouter paiement espèces"
                      >
                        Esp.
                      </button>
                    )}
                    {(isDone || isPartial) && invoiceToLinkIds[inv.id] && (
                      <button
                        onClick={() => onUnlinkInvoice(invoiceToLinkIds[inv.id])}
                        disabled={unlinkPending}
                        className="text-xs text-red-400 hover:text-red-600 font-medium whitespace-nowrap"
                      >
                        Délier
                      </button>
                    )}
                  </div>
                </div>
                {/* Inline cash input */}
                {cashInvoiceId === inv.id && (
                  <div className="px-3 py-2 bg-gray-50 flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={cashAmount}
                      onChange={(e) => setCashAmount(e.target.value)}
                      placeholder={`Espèces (max ${Math.round(remaining)})`}
                      className="input !py-1.5 !text-sm flex-1"
                      autoFocus
                    />
                    <button
                      onClick={() => handleAddCash(inv.id)}
                      disabled={!cashAmount || cashMutation.isPending}
                      className="text-xs bg-pine text-white px-3 py-1.5 rounded-lg hover:bg-pine-hover disabled:opacity-50"
                    >
                      {cashMutation.isPending ? "..." : "OK"}
                    </button>
                    <button
                      onClick={() => { setCashInvoiceId(null); setCashAmount(""); }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
