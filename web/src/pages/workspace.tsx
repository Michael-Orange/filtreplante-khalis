import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api } from "../lib/api";
import { formatCFA, formatDate, formatDateShort } from "../lib/format";
import { CsvUpload } from "../components/csv-upload";
import { SummaryBar } from "../components/summary-bar";

interface SessionDetail {
  id: string;
  label: string;
  dateStart: string;
  dateEnd: string;
  status: string;
  waveTransactions: WaveTransaction[];
}

interface WaveTransaction {
  id: string;
  transactionId: string;
  transactionDate: string;
  amount: string;
  counterpartyName: string | null;
  counterpartyMobile: string | null;
}

interface InvoiceRow {
  id: string;
  invoiceDate: string;
  supplierName: string | null;
  supplierId: string;
  category: string;
  categoryAppName: string | null;
  amountDisplayTTC: string;
  description: string;
  paymentType: string;
  invoiceType: string | null;
  invoiceNumber: string | null;
  hasBrs: boolean | null;
  paymentStatus: string | null;
  amount: number;
  paidInFacture: number;
  remainingDue: number;
  reconciledWave: number;
  reconciledCash: number;
  reconciledTotal: number;
  reconStatus: "done" | "partial" | "pending";
}

interface ReconciliationLink {
  id: string;
  invoiceId: string;
  waveTransactionId: string | null;
  waveAmount: string;
  cashAmount: string;
  waveDate: string | null;
  waveTotal: string | null;
  waveCounterparty: string | null;
  // Invoice details from join
  invoiceAmount: string | null;
  invoiceDate: string | null;
  invoiceDescription: string | null;
  invoicePaymentType: string | null;
  supplierName: string | null;
}

interface Summary {
  totalWaveImported: number;
  totalWaveCount: number;
  totalWaveReconciled: number;
  totalCashReconciled: number;
  invoicesReconciled: number;
  orphanWaves: any[];
  orphanWaveCount: number;
  orphanWaveTotal: number;
}

type WaveFilter = "all" | "linked" | "unlinked";

export function WorkspacePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const sessionId = params.id!;
  const queryClient = useQueryClient();
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);
  const [waveFilter, setWaveFilter] = useState<WaveFilter>("all");
  const [showCashSection, setShowCashSection] = useState(false);

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.get<SessionDetail>(`/api/sessions/${sessionId}`),
  });

  const { data: invoices } = useQuery({
    queryKey: ["invoices", sessionId],
    queryFn: () => api.get<InvoiceRow[]>(`/api/invoices/${sessionId}`),
    enabled: !!session,
  });

  const { data: summary } = useQuery({
    queryKey: ["summary", sessionId],
    queryFn: () => api.get<Summary>(`/api/summary/${sessionId}`),
    enabled: !!session,
  });

  // All reconciliation links for this session (single query)
  const { data: allLinks, isLoading: linksLoading } = useQuery({
    queryKey: ["allLinks", sessionId],
    queryFn: () =>
      api.get<ReconciliationLink[]>(`/api/reconcile/session/${sessionId}`),
    enabled: !!session,
  });

  const hasWaves = session && session.waveTransactions.length > 0;
  const dataReady = hasWaves && !linksLoading && !!allLinks;

  // Build a map: waveId -> array of linked invoices (1 Wave can cover N invoices of same supplier)
  const waveToLinks = useMemo(() => {
    const map: Record<string, {
      linkId: string;
      invoiceId: string;
      waveAmount: number;
      supplierName: string | null;
      invoiceAmount: string | null;
      invoiceDate: string | null;
      invoiceDescription: string | null;
    }[]> = {};
    if (allLinks) {
      for (const link of allLinks) {
        if (link.waveTransactionId) {
          if (!map[link.waveTransactionId]) map[link.waveTransactionId] = [];
          map[link.waveTransactionId].push({
            linkId: link.id,
            invoiceId: link.invoiceId,
            waveAmount: parseFloat(link.waveAmount),
            supplierName: link.supplierName,
            invoiceAmount: link.invoiceAmount,
            invoiceDate: link.invoiceDate,
            invoiceDescription: link.invoiceDescription,
          });
        }
      }
    }
    return map;
  }, [allLinks]);

  // Filter and sort waves by date
  const filteredWaves = useMemo(() => {
    if (!session) return [];
    let waves = [...session.waveTransactions];
    if (waveFilter === "linked") waves = waves.filter((w) => waveToLinks[w.id]);
    if (waveFilter === "unlinked") waves = waves.filter((w) => !waveToLinks[w.id]);
    // Always sort by date
    waves.sort((a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime());
    return waves;
  }, [session, waveFilter, waveToLinks]);

  const selectedWave = session?.waveTransactions.find((w) => w.id === selectedWaveId);

  // Invoices not yet fully reconciled (available for linking)
  const availableInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => inv.reconStatus !== "done");
  }, [invoices]);

  // Invoices with cash-only reconciliation (no wave, just espèces)
  const cashOnlyInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter(
      (inv) => inv.reconciledCash > 0 && inv.reconciledWave === 0
    );
  }, [invoices]);

  // Unreconciled invoices (neither wave nor cash)
  const unreconciledInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => inv.reconStatus === "pending");
  }, [invoices]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["summary", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["allLinks", sessionId] });
  };

  if (sessionLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-4 border-pine border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="text-center py-12 text-gray-400">Session introuvable</div>
    );
  }

  const linkedCount = Object.keys(waveToLinks).length;
  const totalWaves = session.waveTransactions.length;

  return (
    <div className="flex flex-col h-[calc(100vh-52px)]">
      {/* Top bar */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="text-gray-400 hover:text-gray-600"
          >
            &larr;
          </button>
          <div>
            <h2 className="font-heading font-semibold text-gray-900">
              {session.label}
            </h2>
            <p className="text-xs text-gray-500">
              {formatDate(session.dateStart)} — {formatDate(session.dateEnd)}
            </p>
          </div>
        </div>
        {hasWaves && (
          <button
            onClick={() => setShowCashSection(!showCashSection)}
            className="btn-secondary text-xs !px-3 !py-1.5 !min-h-0 !rounded-lg"
          >
            {showCashSection ? "Transactions Wave" : "Espèces"}
          </button>
        )}
      </div>

      {/* CSV Upload if no waves yet */}
      {!hasWaves && !sessionLoading && (
        <CsvUpload sessionId={sessionId} onImported={invalidateAll} />
      )}

      {/* Loading state while links load */}
      {hasWaves && !dataReady && (
        <div className="flex-1 flex justify-center items-center">
          <div className="w-8 h-8 border-4 border-pine border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Main content — Wave-centric view */}
      {dataReady && !showCashSection && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel — Wave transactions */}
          <div
            className={`${
              selectedWaveId ? "hidden lg:flex" : "flex"
            } flex-col flex-1 lg:max-w-[55%] border-r overflow-hidden`}
          >
            {/* Filter chips */}
            <div className="flex gap-2 px-4 py-2 border-b bg-gray-50 flex-shrink-0">
              {(
                [
                  ["all", `Tous (${totalWaves})`],
                  ["unlinked", `A faire (${totalWaves - linkedCount})`],
                  ["linked", `OK (${linkedCount})`],
                ] as [WaveFilter, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setWaveFilter(key)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    waveFilter === key
                      ? "bg-pine text-white"
                      : "bg-white text-gray-600 border hover:border-pine/30"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Wave transaction list */}
            <div className="flex-1 overflow-y-auto">
              {filteredWaves.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Aucune transaction pour ce filtre
                </div>
              ) : (
                <div className="divide-y">
                  {filteredWaves.map((wave) => {
                    const wLinks = waveToLinks[wave.id] || [];
                    const isLinked = wLinks.length > 0;
                    const totalAllocated = wLinks.reduce((s, l) => s + l.waveAmount, 0);

                    // Check if wave has unused credit (allocated < wave amount)
                    const waveAmt = parseFloat(wave.amount);
                    const hasUnusedCredit = isLinked && waveAmt > totalAllocated + 1;

                    return (
                      <button
                        key={wave.id}
                        onClick={() => setSelectedWaveId(wave.id)}
                        className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 ${
                          selectedWaveId === wave.id ? "bg-pine-light" : ""
                        }`}
                      >
                        {/* Status indicator */}
                        <div
                          className={`w-1.5 h-10 rounded-full flex-shrink-0 ${
                            hasUnusedCredit ? "bg-orange-400" : isLinked ? "bg-green-500" : "bg-gray-300"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 whitespace-nowrap">
                              {formatDateShort(wave.transactionDate)}
                            </span>
                            <span className="font-medium text-sm text-gray-900">
                              {formatCFA(parseFloat(wave.amount))}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500 truncate mt-0.5">
                            {wave.counterpartyName || "—"}
                          </div>
                          {isLinked && (
                            <div className={`text-xs mt-1 truncate ${hasUnusedCredit ? "text-orange-500" : "text-green-600"}`}>
                              → {wLinks.length} facture{wLinks.length > 1 ? "s" : ""} · {formatCFA(totalAllocated)}
                              {hasUnusedCredit && (
                                <span className="ml-1 font-medium">
                                  (surplus: {formatCFA(waveAmt - totalAllocated)})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right panel — Link invoice to selected wave */}
          <div
            className={`${
              selectedWaveId ? "flex" : "hidden lg:flex"
            } flex-col flex-1 overflow-hidden`}
          >
            {selectedWave ? (
              <WaveLinkPanel
                wave={selectedWave}
                sessionId={sessionId}
                invoices={invoices || []}
                links={waveToLinks[selectedWave.id] || []}
                onBack={() => setSelectedWaveId(null)}
                onChanged={invalidateAll}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                Sélectionnez une transaction Wave
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cash section — manage espèces payments */}
      {dataReady && showCashSection && (
        <CashSection
          invoices={invoices || []}
          sessionId={sessionId}
          onChanged={invalidateAll}
        />
      )}

      {/* Unreconciled invoices alert */}
      {unreconciledInvoices.length > 0 && dataReady && (
        <div className="bg-orange-50 border-t border-orange-200 px-4 py-2 flex-shrink-0">
          <div className="text-orange-700 text-sm font-medium">
            {unreconciledInvoices.length} facture{unreconciledInvoices.length > 1 ? "s" : ""} non rapprochée{unreconciledInvoices.length > 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Summary bar */}
      {summary && <SummaryBar summary={summary} invoiceCount={invoices?.length || 0} />}
    </div>
  );
}

// ─── Wave Link Panel (right side) ─────────────────────────────────

function WaveLinkPanel({
  wave,
  sessionId,
  invoices,
  links,
  onBack,
  onChanged,
}: {
  wave: WaveTransaction;
  sessionId: string;
  invoices: InvoiceRow[];
  links: {
    linkId: string;
    invoiceId: string;
    waveAmount: number;
    supplierName: string | null;
    invoiceAmount: string | null;
    invoiceDate: string | null;
    invoiceDescription: string | null;
  }[];
  onBack: () => void;
  onChanged: () => void;
}) {
  const waveAmount = parseFloat(wave.amount);
  const totalAllocated = links.reduce((s, l) => s + l.waveAmount, 0);
  const isLinked = links.length > 0;
  const surplus = waveAmount - totalAllocated;

  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);

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
      onChanged();
    },
    onError: () => setPendingInvoiceId(null),
  });

  // Unlink ALL links for this wave (cascade)
  const unlinkMutation = useMutation({
    mutationFn: () => api.delete(`/api/reconcile/wave/${wave.id}`),
    onSuccess: () => onChanged(),
  });

  const showLinked = isLinked || pendingInvoiceId;

  // Group invoices by supplier, sorted: partial suppliers first, then closest amount
  const groupedInvoices = useMemo(() => {
    const available = invoices.filter((inv) => inv.reconStatus !== "done");
    const groups: Record<string, { supplierName: string; invoices: InvoiceRow[]; hasPartial: boolean }> = {};

    for (const inv of available) {
      const key = inv.supplierId || "unknown";
      if (!groups[key]) {
        groups[key] = { supplierName: inv.supplierName || "—", invoices: [], hasPartial: false };
      }
      groups[key].invoices.push(inv);
      if (inv.reconStatus === "partial") groups[key].hasPartial = true;
    }

    return Object.values(groups).sort((a, b) => {
      if (a.hasPartial && !b.hasPartial) return -1;
      if (!a.hasPartial && b.hasPartial) return 1;
      const bestA = Math.min(...a.invoices.map((inv) => Math.abs((inv.remainingDue - inv.reconciledTotal) - waveAmount)));
      const bestB = Math.min(...b.invoices.map((inv) => Math.abs((inv.remainingDue - inv.reconciledTotal) - waveAmount)));
      return bestA - bestB;
    });
  }, [invoices, waveAmount]);

  return (
    <div className="flex flex-col h-full">
      {/* Wave header */}
      <div className="bg-white border-b px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={onBack} className="lg:hidden text-gray-400 hover:text-gray-600">&larr;</button>
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
            <p className="text-red-600 text-sm">{(linkMutation.error as any)?.message || "Erreur"}</p>
          </div>
        )}

        {/* Available invoices grouped by supplier */}
        {!showLinked && (
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
                  <div key={group.supplierName} className={`rounded-lg border ${group.hasPartial ? "border-orange-200" : "border-gray-200"}`}>
                    <div className={`px-3 py-2 text-sm font-medium rounded-t-lg ${group.hasPartial ? "bg-orange-50 text-orange-800" : "bg-gray-50 text-gray-700"}`}>
                      {group.supplierName}
                      <span className="text-xs font-normal ml-2 opacity-70">
                        ({group.invoices.length} facture{group.invoices.length > 1 ? "s" : ""})
                      </span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {group.invoices
                        .sort((a, b) => {
                          if (a.reconStatus === "partial" && b.reconStatus !== "partial") return -1;
                          if (b.reconStatus === "partial" && a.reconStatus !== "partial") return 1;
                          return new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime();
                        })
                        .map((inv) => {
                          const remaining = inv.remainingDue - inv.reconciledTotal;
                          const diff = Math.abs(remaining - waveAmount);
                          const isExactMatch = diff < 1;
                          const isPartial = inv.reconStatus === "partial";

                          return (
                            <div
                              key={inv.id}
                              className={`flex items-center justify-between py-2 px-3 ${
                                isPartial ? "bg-orange-50/50" : isExactMatch ? "bg-green-50/50" : ""
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-gray-900">{formatCFA(inv.amount)}</span>
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
                                  {isPartial && (
                                    <span className="text-orange-500 ml-1">(rapproché: {formatCFA(inv.reconciledTotal)})</span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => linkMutation.mutate(inv.id)}
                                disabled={linkMutation.isPending}
                                className="text-xs text-pine font-medium hover:text-pine-hover whitespace-nowrap ml-2"
                              >
                                Lier
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cash Section ─────────────────────────────────────────────────

function CashSection({
  invoices,
  sessionId,
  onChanged,
}: {
  invoices: InvoiceRow[];
  sessionId: string;
  onChanged: () => void;
}) {
  const [cashInputs, setCashInputs] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const linkMutation = useMutation({
    mutationFn: (data: { invoiceId: string; cashAmount: number }) =>
      api.post("/api/reconcile", {
        sessionId,
        invoiceId: data.invoiceId,
        cashAmount: data.cashAmount,
      }),
    onSuccess: () => onChanged(),
  });

  const handleAddCash = (invoiceId: string) => {
    const amount = parseInt(cashInputs[invoiceId] || "0") || 0;
    if (amount <= 0) return;
    linkMutation.mutate({ invoiceId, cashAmount: amount });
    setCashInputs((prev) => ({ ...prev, [invoiceId]: "" }));
  };

  // Show invoices that still need reconciliation
  const pendingInvoices = invoices.filter((inv) => inv.reconStatus !== "done");

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <h3 className="font-heading font-semibold text-gray-900 mb-3">
        Paiements espèces
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        Ajoutez les montants payés en espèces pour chaque facture.
      </p>

      {pendingInvoices.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          Toutes les factures sont rapprochées
        </div>
      ) : (
        <div className="space-y-2">
          {pendingInvoices.map((inv) => {
            const toReconcile = inv.remainingDue - inv.reconciledTotal;

            return (
              <div key={inv.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-medium text-sm text-gray-900">
                      {inv.supplierName || "—"}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">
                      {formatDateShort(inv.invoiceDate)}
                    </span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatCFA(inv.amount)}
                  </span>
                </div>
                {inv.reconciledTotal > 0 && (
                  <div className="text-xs text-gray-500 mb-2">
                    Déjà rapproché : {formatCFA(inv.reconciledTotal)}
                    {inv.reconciledWave > 0 && ` (Wave: ${formatCFA(inv.reconciledWave)})`}
                    {inv.reconciledCash > 0 && ` (Espèces: ${formatCFA(inv.reconciledCash)})`}
                    {" · "}Reste : {formatCFA(Math.max(0, toReconcile))}
                  </div>
                )}
                {toReconcile > 0 && (
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={cashInputs[inv.id] || ""}
                      onChange={(e) =>
                        setCashInputs((prev) => ({
                          ...prev,
                          [inv.id]: e.target.value,
                        }))
                      }
                      placeholder={`Espèces (reste ${Math.round(toReconcile)})`}
                      className="input !py-2 flex-1 text-sm"
                    />
                    <button
                      onClick={() => handleAddCash(inv.id)}
                      disabled={
                        !cashInputs[inv.id] || linkMutation.isPending
                      }
                      className="btn-secondary text-xs !px-3 !py-2 !min-h-0"
                    >
                      Ajouter
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
