import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api } from "../lib/api";
import { formatCFA, formatDate, formatDateShort } from "../lib/format";
import { CsvUpload } from "../components/csv-upload";
import { SummaryBar } from "../components/summary-bar";
import { WaveMetadata } from "../components/wave-metadata";

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
  projectId: string | null;
  allocations: { name: string; amount: number }[] | null;
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
  const [expandedWaveId, setExpandedWaveId] = useState<string | null>(null);
  const [waveFilter, setWaveFilter] = useState<WaveFilter>("all");
  const [activeTab, setActiveTab] = useState<"rapprochement" | "resume">("rapprochement");

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

  // All allocations across all waves (for autocomplete)
  const allWaveAllocations = useMemo(() => {
    if (!session) return [];
    return session.waveTransactions.flatMap((w) => w.allocations || []);
  }, [session]);
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
        <div className="flex items-center gap-2">
          {hasWaves && (
            <button
              onClick={invalidateAll}
              className="text-xs text-gray-400 hover:text-pine transition-colors p-1.5"
              title="Rafraîchir les factures"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {dataReady && (
        <div className="flex border-b bg-white flex-shrink-0">
          <button
            onClick={() => setActiveTab("rapprochement")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "rapprochement"
                ? "border-pine text-pine"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Rapprochement
          </button>
          <button
            onClick={() => setActiveTab("resume")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "resume"
                ? "border-pine text-pine"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Résumé dépenses
          </button>
        </div>
      )}

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

      {/* Resume tab */}
      {dataReady && activeTab === "resume" && (
        <ResumeTab waves={session.waveTransactions} projects={[]} sessionId={sessionId} />
      )}

      {/* Main content — Wave-centric view */}
      {dataReady && activeTab === "rapprochement" && (
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

                    const isExpanded = expandedWaveId === wave.id;
                    const hasMetadata = wave.projectId || (wave.allocations && wave.allocations.length > 0);

                    return (
                      <div key={wave.id}>
                        <div
                          className={`flex items-center gap-3 ${
                            selectedWaveId === wave.id ? "bg-pine-light" : ""
                          }`}
                        >
                          {/* Status indicator */}
                          <div
                            className={`w-1.5 self-stretch rounded-full flex-shrink-0 ml-1 ${
                              hasUnusedCredit ? "bg-orange-400" : isLinked ? "bg-green-500" : "bg-gray-300"
                            }`}
                          />
                          <button
                            onClick={() => setSelectedWaveId(wave.id)}
                            className="flex-1 min-w-0 text-left px-2 py-3 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {formatDateShort(wave.transactionDate)}
                              </span>
                              <span className="font-medium text-sm text-gray-900">
                                {formatCFA(waveAmt)}
                              </span>
                              {hasMetadata && (
                                <span className="inline-flex items-center gap-0.5 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                  Facture
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 truncate mt-0.5">
                              {wave.counterpartyName || "—"}
                            </div>
                            {isLinked && (
                              <div className="mt-1 space-y-0.5">
                                {wLinks.map((link) => (
                                  <div key={link.linkId} className={`text-xs truncate ${hasUnusedCredit ? "text-orange-500" : "text-green-600"}`}>
                                    → {link.supplierName || "—"} · {formatCFA(link.waveAmount)}
                                    {link.invoiceDate && (
                                      <span className="opacity-70 ml-1">{formatDateShort(link.invoiceDate)}</span>
                                    )}
                                  </div>
                                ))}
                                {hasUnusedCredit && (
                                  <div className="text-xs text-orange-500 font-medium">
                                    Surplus: {formatCFA(waveAmt - totalAllocated)}
                                  </div>
                                )}
                              </div>
                            )}
                          </button>
                          {/* Expand button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedWaveId(isExpanded ? null : wave.id);
                            }}
                            className={`text-gray-300 hover:text-pine p-2 flex-shrink-0 transition-colors ${isExpanded ? "text-pine" : ""}`}
                            title="Détails"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points={isExpanded ? "18 15 12 9 6 15" : "6 9 12 15 18 9"} />
                            </svg>
                          </button>
                        </div>
                        {/* Expandable metadata panel */}
                        {isExpanded && (
                          <WaveMetadata
                            waveId={wave.id}
                            waveAmount={waveAmt}
                            currentProjectId={wave.projectId}
                            currentAllocations={wave.allocations || []}
                            allWaveAllocations={allWaveAllocations}
                            onChanged={invalidateAll}
                          />
                        )}
                      </div>
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
                allLinks={allLinks || []}
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
  allLinks,
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
  allLinks: ReconciliationLink[];
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

  // Unlink a single link by ID
  const unlinkSingleMutation = useMutation({
    mutationFn: (linkId: string) => api.delete(`/api/reconcile/${linkId}`),
    onSuccess: () => onChanged(),
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
                  <SupplierGroup
                    key={group.supplierName}
                    group={group}
                    waveAmount={waveAmount}
                    sessionId={sessionId}
                    allLinks={allLinks || []}
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
  const [cashInvoiceId, setCashInvoiceId] = useState<string | null>(null);
  const [cashAmount, setCashAmount] = useState("");

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
      onChanged();
    },
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

// ─── Resume Tab ───────────────────────────────────────────────────

function ResumeTab({
  waves,
  sessionId,
}: {
  waves: WaveTransaction[];
  projects: any[];
  sessionId: string;
}) {
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<{ id: string; name: string }[]>("/api/metadata/projects"),
    staleTime: 5 * 60_000,
  });

  // Build summary from wave metadata
  const wavesWithMeta = waves.filter(
    (w) => w.projectId || (w.allocations && w.allocations.length > 0)
  );

  // Group by project
  const projectMap = new Map<string, {
    projectName: string;
    persons: Map<string, number>;
    totalAmount: number;
    waveCount: number;
  }>();

  for (const w of wavesWithMeta) {
    const projId = w.projectId || "__none__";
    const projName =
      w.projectId && projects
        ? projects.find((p) => p.id === w.projectId)?.name || "Projet inconnu"
        : "Sans projet";

    if (!projectMap.has(projId)) {
      projectMap.set(projId, {
        projectName: projName,
        persons: new Map(),
        totalAmount: 0,
        waveCount: 0,
      });
    }
    const group = projectMap.get(projId)!;
    group.waveCount++;

    if (w.allocations) {
      for (const alloc of w.allocations) {
        group.persons.set(
          alloc.name,
          (group.persons.get(alloc.name) || 0) + alloc.amount
        );
        group.totalAmount += alloc.amount;
      }
    }
  }

  // Also build per-person summary across all projects
  const personTotals = new Map<string, number>();
  for (const [, group] of projectMap) {
    for (const [name, amount] of group.persons) {
      personTotals.set(name, (personTotals.get(name) || 0) + amount);
    }
  }

  const grandTotal = Array.from(personTotals.values()).reduce((s, a) => s + a, 0);

  if (wavesWithMeta.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm p-8">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-gray-300">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <p>Aucune dépense renseignée.</p>
          <p className="mt-1 text-xs">Utilisez le chevron (v) sur chaque transaction Wave pour ajouter un projet et une répartition.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Per-person summary */}
      <div className="p-4">
        <h3 className="font-heading font-semibold text-gray-900 mb-3">
          Récapitulatif par personne
        </h3>
        <div className="bg-white rounded-xl border border-gray-200 divide-y">
          {Array.from(personTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name, amount]) => (
              <div key={name} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-pine-light text-pine flex items-center justify-center text-sm font-semibold">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{name}</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {formatCFA(amount)}
                </span>
              </div>
            ))}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
            <span className="text-sm font-semibold text-gray-700">Total</span>
            <span className="text-sm font-bold text-gray-900">{formatCFA(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Per-project breakdown */}
      <div className="p-4 pt-0">
        <h3 className="font-heading font-semibold text-gray-900 mb-3">
          Détail par projet
        </h3>
        <div className="space-y-3">
          {Array.from(projectMap.entries()).map(([projId, group]) => (
            <div key={projId} className="bg-white rounded-xl border border-gray-200">
              <div className="px-4 py-3 border-b bg-gray-50 rounded-t-xl flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {group.projectName}
                  </span>
                  <span className="text-xs text-gray-500 ml-2">
                    ({group.waveCount} transaction{group.waveCount > 1 ? "s" : ""})
                  </span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {formatCFA(group.totalAmount)}
                </span>
              </div>
              <div className="divide-y">
                {Array.from(group.persons.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, amount]) => (
                    <div key={name} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                          {name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm text-gray-700">{name}</span>
                      </div>
                      <span className="text-sm text-gray-900">{formatCFA(amount)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

