import { useState, useMemo, useEffect } from "react";
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

interface CashAllocation {
  id: string;
  sessionId: string;
  projectId: string;
  personName: string;
  amount: string;
}

interface Project {
  id: string;
  number?: string;
  name: string;
  isCompleted?: boolean | null;
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

  // All allocations across all waves (for autocomplete) — must be before conditional returns
  const allWaveAllocations = useMemo(() => {
    if (!session) return [];
    return session.waveTransactions.flatMap((w) => w.allocations || []);
  }, [session]);

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
        <ResumeTab waves={session.waveTransactions} sessionId={sessionId} />
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
                                <span className="ml-auto inline-flex items-center gap-0.5 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                  Réglement facture d'équipe
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

// ─── Auto-link Wave → Facture d'équipe (étape 3) ────────────
//
// Algo : chaque wave flagué RFE est auto-lié à UNE personne cible.
// Résolution :
//   1) counterparty startsWith match vs personnes ayant des factures
//   2) sinon, 1ère personne du chevron si elle a des factures
//   3) sinon, 1ère personne arbitraire avec capacité restante
// Le wave entier est ensuite distribué sur TOUTES les factures de
// cette personne (chevron + cash), dans l'ordre alphabétique de la
// clé projet. Waves traités par date croissante pour que la date
// facture = date du 1er wave lié (priorité #4).
// Fonction pure — sans side-effect sur React — pour pouvoir la
// cacher dans un useState et contrôler les recalculs via un bouton.
type LinkedWaveEntry = {
  waveId: string;
  date: string;
  counterparty: string | null;
  amount: number;
};
type AutoLinksResult = {
  linkedByFactureKey: Map<string, LinkedWaveEntry[]>;
  totalWaveUnlinked: number;
};

function computeAutoLinks(
  wavesWithMeta: WaveTransaction[],
  cashAllocations: CashAllocation[],
  projectMap: Map<string, { persons: Map<string, { amount: number }> }>,
): AutoLinksResult {
  const linkedByFactureKey = new Map<string, LinkedWaveEntry[]>();
  let totalWaveUnlinked = 0;

  // Construction de l'index des factures par personne.
  // Inclut les factures issues du chevron ET les factures cash-only.
  // La capacité d'une facture = chevron amount + cash amount (total
  // affiché en section 3). Un wave peut remplir jusqu'à cette capacité.
  const factureTotal = new Map<string, { personName: string; amount: number }>();
  for (const [pid, g] of projectMap) {
    for (const [personName, entry] of g.persons) {
      const factureKey = `${pid}|${personName}`;
      factureTotal.set(factureKey, { personName, amount: entry.amount });
    }
  }
  for (const c of cashAllocations) {
    const factureKey = `${c.projectId}|${c.personName}`;
    if (factureTotal.has(factureKey)) {
      factureTotal.get(factureKey)!.amount += Number(c.amount);
    } else {
      factureTotal.set(factureKey, {
        personName: c.personName,
        amount: Number(c.amount),
      });
    }
  }

  const personFactureIndex = new Map<
    string,
    Array<{ factureKey: string; remaining: number }>
  >();
  for (const [factureKey, { personName, amount }] of factureTotal) {
    if (!personFactureIndex.has(personName)) {
      personFactureIndex.set(personName, []);
    }
    personFactureIndex.get(personName)!.push({ factureKey, remaining: amount });
  }

  const linkToFacture = (
    factureKey: string,
    wave: WaveTransaction,
    desired: number,
  ): number => {
    for (const arr of personFactureIndex.values()) {
      for (const f of arr) {
        if (f.factureKey === factureKey) {
          const linkAmount = Math.min(desired, f.remaining);
          if (linkAmount <= 0) return 0;
          f.remaining -= linkAmount;
          if (!linkedByFactureKey.has(factureKey)) {
            linkedByFactureKey.set(factureKey, []);
          }
          linkedByFactureKey.get(factureKey)!.push({
            waveId: wave.id,
            date: wave.transactionDate,
            counterparty: wave.counterpartyName,
            amount: linkAmount,
          });
          return linkAmount;
        }
      }
    }
    return 0;
  };

  const sortedWaves = wavesWithMeta
    .filter((w) => w.allocations && w.allocations.length > 0)
    .slice()
    .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

  for (const wave of sortedWaves) {
    // Résolution personne cible
    let targetPerson: string | null = null;

    if (wave.counterpartyName) {
      const firstToken = wave.counterpartyName.trim().split(/\s+/)[0] || "";
      if (firstToken.length >= 2) {
        for (const personName of personFactureIndex.keys()) {
          if (personName.toLowerCase().startsWith(firstToken.toLowerCase())) {
            targetPerson = personName;
            break;
          }
        }
      }
    }

    if (!targetPerson && wave.allocations && wave.allocations[0]) {
      const firstChev = wave.allocations[0].name;
      if (personFactureIndex.has(firstChev)) {
        targetPerson = firstChev;
      }
    }

    if (!targetPerson) {
      for (const [personName, factures] of personFactureIndex) {
        if (factures.some((f) => f.remaining > 0)) {
          targetPerson = personName;
          break;
        }
      }
    }

    if (!targetPerson) {
      totalWaveUnlinked += Number(wave.amount);
      continue;
    }

    const factures = personFactureIndex.get(targetPerson)!;
    const ordered = factures
      .slice()
      .sort((a, b) => a.factureKey.localeCompare(b.factureKey));

    let waveRemaining = Number(wave.amount);
    for (const f of ordered) {
      if (waveRemaining <= 0) break;
      const linked = linkToFacture(f.factureKey, wave, waveRemaining);
      waveRemaining -= linked;
    }

    if (waveRemaining > 0) totalWaveUnlinked += waveRemaining;
  }

  return { linkedByFactureKey, totalWaveUnlinked };
}

// ─── Resume Tab ───────────────────────────────────────────────────

function ResumeTab({
  waves,
  sessionId,
}: {
  waves: WaveTransaction[];
  sessionId: string;
}) {
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/api/metadata/projects"),
    staleTime: 5 * 60_000,
  });
  const projects = projectsQuery.data;

  const cashQuery = useQuery({
    queryKey: ["cash", sessionId],
    queryFn: () => api.get<CashAllocation[]>(`/api/cash/${sessionId}`),
  });
  const cashAllocations = cashQuery.data ?? [];

  const personsQuery = useQuery({
    queryKey: ["persons"],
    queryFn: () => api.get<{ name: string }[]>("/api/metadata/persons"),
    staleTime: 5 * 60_000,
  });
  const persons = personsQuery.data ?? [];

  const allDataLoaded =
    projectsQuery.isSuccess && cashQuery.isSuccess && personsQuery.isSuccess;

  const [pendingManualProjectIds, setPendingManualProjectIds] = useState<string[]>([]);
  const [expandedFactureKeys, setExpandedFactureKeys] = useState<Set<string>>(new Set());

  const toggleFactureExpand = (key: string) => {
    setExpandedFactureKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const invalidateCash = () =>
    queryClient.invalidateQueries({ queryKey: ["cash", sessionId] });

  const createCashMutation = useMutation({
    mutationFn: (body: {
      projectId: string;
      personName: string;
      amount: number;
    }) =>
      api.post<CashAllocation>("/api/cash", {
        sessionId,
        projectId: body.projectId,
        personName: body.personName,
        amount: body.amount,
      }),
    onSuccess: () => invalidateCash(),
  });

  const updateCashMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.patch<CashAllocation>(`/api/cash/${id}`, { amount }),
    onSuccess: () => invalidateCash(),
  });

  const deleteCashLineMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/cash/${id}`),
    onSuccess: () => invalidateCash(),
  });

  const deleteCashBlockMutation = useMutation({
    mutationFn: (projectId: string) =>
      api.delete(`/api/cash/session/${sessionId}/project/${projectId}`),
    onSuccess: () => invalidateCash(),
  });

  // Build summary from wave metadata
  const wavesWithMeta = waves.filter(
    (w) => w.projectId || (w.allocations && w.allocations.length > 0)
  );

  // Group by wave.projectId × person
  // 1 wave = 1 projet + plusieurs personnes dans ses allocations.
  // Le montant de la facture (projet × personne) = somme des allocations
  // pour cette personne sur les waves ayant ce projet.
  const projectMap = new Map<string, {
    projectName: string;
    persons: Map<string, { amount: number }>;
    totalAmount: number;
    waveIds: Set<string>;
  }>();

  for (const w of wavesWithMeta) {
    if (!w.allocations || w.allocations.length === 0) continue;
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
        waveIds: new Set(),
      });
    }
    const group = projectMap.get(projId)!;
    group.waveIds.add(w.id);

    for (const alloc of w.allocations) {
      group.totalAmount += alloc.amount;
      const personEntry = group.persons.get(alloc.name) || { amount: 0 };
      personEntry.amount += alloc.amount;
      group.persons.set(alloc.name, personEntry);
    }
  }

  // Per-person summary across wave
  const personTotals = new Map<string, number>();
  for (const [, group] of projectMap) {
    for (const [name, entry] of group.persons) {
      personTotals.set(name, (personTotals.get(name) || 0) + entry.amount);
    }
  }
  const waveGrandTotal = Array.from(personTotals.values()).reduce((s, a) => s + a, 0);

  // ─── Cash blocks ─────────────────────────────────────
  // Wave project ids = effective project ids (from allocations) excluding "__none__"
  const waveProjectIds = new Set<string>(
    Array.from(projectMap.keys()).filter((pid) => pid !== "__none__"),
  );
  const cashProjectIds = new Set(cashAllocations.map((c) => c.projectId));
  const blockProjectIds = Array.from(
    new Set<string>([
      ...Array.from(waveProjectIds),
      ...Array.from(cashProjectIds),
      ...pendingManualProjectIds,
    ])
  );

  const cashBlocks = blockProjectIds
    .map((pid) => {
      const lines = cashAllocations.filter((c) => c.projectId === pid);
      const projName =
        projects?.find((p) => p.id === pid)?.name || "Projet inconnu";
      const isManual = !waveProjectIds.has(pid);
      const total = lines.reduce((s, l) => s + Number(l.amount), 0);
      return {
        projectId: pid,
        projectName: projName,
        lines,
        isManual,
        hasPersistedLines: lines.length > 0,
        total,
      };
    })
    // Wave-origin blocks first (stable), then manual
    .sort((a, b) => {
      if (a.isManual === b.isManual) return a.projectName.localeCompare(b.projectName);
      return a.isManual ? 1 : -1;
    });

  const availableProjectsForAdd = (projects || []).filter(
    (p) => !blockProjectIds.includes(p.id)
  );

  const handleDeleteBlock = (projectId: string, hasPersisted: boolean) => {
    if (hasPersisted) {
      deleteCashBlockMutation.mutate(projectId);
    }
    setPendingManualProjectIds((prev) => prev.filter((id) => id !== projectId));
  };

  // Autocomplete pool for "+ Autre" : persons connues + noms déjà utilisés
  // dans wave ou caisse de la session (dédupliqués).
  const suggestionPool = Array.from(
    new Set<string>([
      ...persons.map((p) => p.name),
      ...wavesWithMeta.flatMap((w) => (w.allocations || []).map((a) => a.name)),
      ...cashAllocations.map((c) => c.personName),
    ]),
  );

  // ─── Étape 3 — Liaisons wave → facture d'équipe ──────────────
  // Recalculé à chaque rendu via useMemo. Les dépendances incluent
  // une signature des données (longueurs + sums) pour détecter les
  // changements, ET un linksVersion qu'on peut bumper manuellement
  // via le bouton "Recalculer" (utile si l'utilisateur veut forcer
  // un recompute sans toucher aux données).
  const [linksVersion, setLinksVersion] = useState(0);

  // Signature de bas niveau des données : change si waves/cash/projectMap change
  const dataSignature = `${wavesWithMeta
    .map((w) => `${w.id}:${w.projectId || ""}:${(w.allocations || []).length}`)
    .join(",")}|${cashAllocations.length}|${projectMap.size}`;

  const { linkedByFactureKey, totalWaveUnlinked } = useMemo<AutoLinksResult>(
    () => computeAutoLinks(wavesWithMeta, cashAllocations, projectMap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linksVersion, dataSignature, allDataLoaded],
  );

  const handleRefreshLinks = () => {
    setLinksVersion((v) => v + 1);
  };

  // ─── Merged project map (wave + cash) for section 3 ─────────
  type MergedPerson = {
    wave: number;
    caisse: number;
    linkedWaves: LinkedWaveEntry[];
    factureDate: string | null; // min des dates des waves auto-liés
  };
  const mergedProjectMap = new Map<string, {
    projectName: string;
    persons: Map<string, MergedPerson>;
    waveTotal: number;
    cashTotal: number;
    waveCount: number;
  }>();

  for (const [pid, g] of projectMap) {
    const persons = new Map<string, MergedPerson>();
    for (const [name, entry] of g.persons) {
      const factureKey = `${pid}|${name}`;
      const linked = linkedByFactureKey.get(factureKey) || [];
      const factureDate = linked.reduce<string | null>(
        (min, w) => (min === null || w.date < min ? w.date : min),
        null,
      );
      persons.set(name, {
        wave: entry.amount,
        caisse: 0,
        linkedWaves: linked,
        factureDate,
      });
    }
    mergedProjectMap.set(pid, {
      projectName: g.projectName,
      persons,
      waveTotal: g.totalAmount,
      cashTotal: 0,
      waveCount: g.waveIds.size,
    });
  }

  // Add cash allocations
  for (const c of cashAllocations) {
    const pid = c.projectId;
    if (!mergedProjectMap.has(pid)) {
      mergedProjectMap.set(pid, {
        projectName: projects?.find((p) => p.id === pid)?.name || "Projet inconnu",
        persons: new Map(),
        waveTotal: 0,
        cashTotal: 0,
        waveCount: 0,
      });
    }
    const entry = mergedProjectMap.get(pid)!;
    const existing = entry.persons.get(c.personName) || {
      wave: 0,
      caisse: 0,
      linkedWaves: [],
      factureDate: null,
    };
    existing.caisse += Number(c.amount);
    entry.persons.set(c.personName, existing);
    entry.cashTotal += Number(c.amount);
  }

  if (wavesWithMeta.length === 0 && cashAllocations.length === 0) {
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
      {/* Section 1 — Réglements wave par personne */}
      <div className="p-4">
        <h3 className="font-heading font-semibold text-gray-900 mb-3">
          Réglements wave par personne
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
            <span className="text-sm font-bold text-gray-900">{formatCFA(waveGrandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Section 2 — Réglements Caisse Fatou par personne */}
      <div className="p-4 pt-0">
        <h3 className="font-heading font-semibold text-gray-900 mb-3">
          Réglements Caisse Fatou par personne
        </h3>
        <div className="space-y-3">
          {cashBlocks.map((block) => (
            <CashProjectBlock
              key={block.projectId}
              projectId={block.projectId}
              projectName={block.projectName}
              lines={block.lines}
              total={block.total}
              isManual={block.isManual}
              persons={persons}
              suggestionPool={suggestionPool}
              onAddPerson={(name) =>
                createCashMutation.mutate({
                  projectId: block.projectId,
                  personName: name,
                  amount: 0,
                })
              }
              onUpdateAmount={(id, amount) =>
                updateCashMutation.mutate({ id, amount })
              }
              onDeleteLine={(id) => deleteCashLineMutation.mutate(id)}
              onDeleteBlock={() =>
                handleDeleteBlock(block.projectId, block.hasPersistedLines)
              }
            />
          ))}
          {availableProjectsForAdd.length > 0 && (
            <AddProjectButton
              availableProjects={availableProjectsForAdd}
              onAdd={(projectId) =>
                setPendingManualProjectIds((prev) =>
                  prev.includes(projectId) ? prev : [...prev, projectId]
                )
              }
            />
          )}
        </div>
      </div>

      {/* Section 3 — Facture par projet et par personne (total wave + caisse) */}
      <div className="p-4 pt-0">
        {(() => {
          const totalWaveRFE = waveGrandTotal;
          const totalCashRFE = cashAllocations.reduce(
            (s, c) => s + Number(c.amount),
            0,
          );
          const totalFactures = Array.from(mergedProjectMap.values()).reduce(
            (s, g) => s + g.waveTotal + g.cashTotal,
            0,
          );
          const sumRFE = totalWaveRFE + totalCashRFE;
          const discrepancy = totalFactures - sumRFE;
          const hasDiscrepancy = Math.abs(discrepancy) > 0.01;
          return (
            <div className="mb-3 bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b text-xs font-semibold uppercase tracking-wide text-gray-500">
                Récapitulatif règlements
              </div>
              <div className="divide-y">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="text-sm text-gray-700">
                      Total des Règlements Wave pour Factures d'équipe
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-blue-700">
                    {formatCFA(totalWaveRFE)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-600">
                      <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>
                    </svg>
                    <span className="text-sm text-gray-700">
                      Total des Règlements Caisse pour Factures d'équipe
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-amber-700">
                    {formatCFA(totalCashRFE)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50/80">
                  <span className="text-sm font-semibold text-gray-700">
                    Total règlements
                  </span>
                  <span className="text-sm font-bold text-gray-900">
                    {formatCFA(sumRFE)}
                  </span>
                </div>
                <div
                  className={`flex items-center justify-between px-4 py-2.5 ${
                    hasDiscrepancy ? "bg-red-50" : ""
                  }`}
                >
                  <span className="text-xs text-gray-500">
                    Total factures ci-dessous
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCFA(totalFactures)}
                    </span>
                    {hasDiscrepancy ? (
                      <span className="text-xs text-red-600 font-medium">
                        ⚠ écart {formatCFA(Math.abs(discrepancy))}
                      </span>
                    ) : (
                      <span className="text-xs text-green-600">✓</span>
                    )}
                  </div>
                </div>
                {totalWaveUnlinked > 0 && (
                  <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50">
                    <span className="text-xs text-amber-700">
                      ⚠ Wave non auto-lié (dépasse la capacité factures de la personne cible)
                    </span>
                    <span className="text-sm font-semibold text-amber-700">
                      {formatCFA(totalWaveUnlinked)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-semibold text-gray-900">
            Facture par projet et par personne
          </h3>
          <button
            type="button"
            onClick={handleRefreshLinks}
            className="cursor-pointer flex items-center gap-1.5 text-xs text-white bg-pine hover:bg-pine-hover active:scale-95 px-3 py-1.5 rounded-lg font-medium transition-all"
            title="Recalcule les liaisons entre règlements wave et factures à partir des données actuelles"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Recalculer les liaisons
          </button>
        </div>
        <div className="space-y-3">
          {Array.from(mergedProjectMap.entries()).map(([projId, group]) => {
            const projectTotal = group.waveTotal + group.cashTotal;
            return (
              <div key={projId} className="bg-white rounded-xl border border-gray-200">
                <div className="px-4 py-3 border-b bg-gray-50 rounded-t-xl flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-900">
                    {group.projectName}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCFA(projectTotal)}
                  </span>
                </div>
                <div className="divide-y">
                  {Array.from(group.persons.entries())
                    .map(([name, amounts]) => ({
                      name,
                      amounts,
                      total: amounts.wave + amounts.caisse,
                    }))
                    .sort((a, b) => b.total - a.total)
                    .map(({ name, amounts, total }) => {
                      const key = `${projId}|${name}`;
                      const isExpanded = expandedFactureKeys.has(key);
                      // Caisse affichée = facture total - total des waves liés.
                      // Représente "ce qu'il reste à régler en caisse" pour
                      // équilibrer la facture, peu importe ce qui est
                      // stocké dans cash_allocations.
                      const linkedWaveSum = amounts.linkedWaves.reduce(
                        (s, lw) => s + lw.amount,
                        0,
                      );
                      const displayCash = Math.max(0, total - linkedWaveSum);
                      return (
                        <div key={name}>
                          <button
                            onClick={() => toggleFactureExpand(key)}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                                {name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm text-gray-700 truncate">{name}</span>
                                {amounts.factureDate && (
                                  <span className="text-[11px] text-gray-400">
                                    Date facture : {formatDateShort(amounts.factureDate)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-sm text-gray-900">{formatCFA(total)}</span>
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-3 bg-gray-50/60 border-t border-gray-100">
                              <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mt-2 mb-1">
                                Règlements
                              </div>
                              <div className="space-y-1">
                                {amounts.linkedWaves.length === 0 && displayCash === 0 && (
                                  <div className="text-xs text-gray-400 italic py-1">
                                    Aucun règlement lié
                                  </div>
                                )}
                                {amounts.linkedWaves
                                  .slice()
                                  .sort((a, b) => a.date.localeCompare(b.date))
                                  .map((cw, idx) => (
                                    <div
                                      key={`${cw.waveId}-${idx}`}
                                      className="flex items-center justify-between text-xs py-1"
                                    >
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                                          </svg>
                                          Wave
                                        </span>
                                        <span className="text-gray-500">
                                          {formatDateShort(cw.date)}
                                        </span>
                                        {cw.counterparty && (
                                          <span className="text-gray-600 truncate">
                                            · {cw.counterparty}
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-gray-900 font-medium flex-shrink-0 ml-2">
                                        {formatCFA(cw.amount)}
                                      </span>
                                    </div>
                                  ))}
                                {displayCash > 0 && (
                                  <div className="flex items-center justify-between text-xs py-1">
                                    <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/>
                                      </svg>
                                      Caisse
                                    </span>
                                    <span className="text-gray-900 font-medium">
                                      {formatCFA(displayCash)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── CashProjectBlock ───────────────────────────────────────

function CashProjectBlock({
  projectId,
  projectName,
  lines,
  total,
  isManual,
  persons,
  suggestionPool,
  onAddPerson,
  onUpdateAmount,
  onDeleteLine,
  onDeleteBlock,
}: {
  projectId: string;
  projectName: string;
  lines: CashAllocation[];
  total: number;
  isManual: boolean;
  persons: { name: string }[];
  suggestionPool: string[];
  onAddPerson: (name: string) => void;
  onUpdateAmount: (id: string, amount: number) => void;
  onDeleteLine: (id: string) => void;
  onDeleteBlock: () => void;
}) {
  const [showManual, setShowManual] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const usedNames = new Set(lines.map((l) => l.personName));
  const availablePersons = persons.filter((p) => !usedNames.has(p.name));

  const trimmedInput = manualInput.trim();
  const suggestions =
    trimmedInput.length >= 1
      ? suggestionPool
          .filter(
            (n) =>
              n.toLowerCase().startsWith(trimmedInput.toLowerCase()) &&
              !usedNames.has(n) &&
              n.toLowerCase() !== trimmedInput.toLowerCase(),
          )
          .slice(0, 5)
      : [];

  const handleAddCustom = () => {
    if (!trimmedInput) return;
    onAddPerson(trimmedInput);
    setManualInput("");
    setShowManual(false);
  };

  const handlePickSuggestion = (name: string) => {
    onAddPerson(name);
    setManualInput("");
    setShowManual(false);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-4 py-3 border-b bg-gray-50 rounded-t-xl flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-gray-900">{projectName}</span>
          {isManual && (
            <span className="text-xs text-amber-600 ml-2">(ajouté manuellement)</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900">{formatCFA(total)}</span>
          {isManual && (
            <button
              onClick={() => {
                if (lines.length === 0 || confirm(`Supprimer le bloc « ${projectName} » et toutes ses lignes ?`)) {
                  onDeleteBlock();
                }
              }}
              className="text-gray-400 hover:text-red-500 transition-colors"
              title="Supprimer le bloc"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="divide-y">
        {lines.length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-400 italic">
            Aucune ligne — ajouter une personne ci-dessous
          </div>
        )}
        {lines
          .slice()
          .sort((a, b) => a.personName.localeCompare(b.personName))
          .map((line) => (
            <CashLineRow
              key={line.id}
              line={line}
              onUpdateAmount={onUpdateAmount}
              onDelete={onDeleteLine}
            />
          ))}
      </div>
      <div className="p-3 border-t bg-gray-50 rounded-b-xl space-y-2">
        <div className="flex items-center gap-2">
          {availablePersons.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onAddPerson(e.target.value);
                }
              }}
              className="flex-1 bg-white border border-dashed border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-500 focus:border-blue-400 focus:outline-none"
            >
              <option value="" disabled>
                + Ajouter une personne
              </option>
              {availablePersons.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => {
              setShowManual(!showManual);
              setManualInput("");
            }}
            className="text-xs text-blue-500 hover:text-blue-700 whitespace-nowrap font-medium"
          >
            + Autre
          </button>
        </div>
        {showManual && (
          <div className="relative">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCustom();
                }}
                placeholder="Nom de la personne"
                className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleAddCustom}
                disabled={!trimmedInput}
                className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                OK
              </button>
            </div>
            {suggestions.length > 0 && (
              <div className="absolute z-10 left-0 right-12 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                {suggestions.map((name) => (
                  <button
                    key={name}
                    onClick={() => handlePickSuggestion(name)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors flex items-center gap-2"
                  >
                    <div className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-xs">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── CashLineRow ────────────────────────────────────────────

function CashLineRow({
  line,
  onUpdateAmount,
  onDelete,
}: {
  line: CashAllocation;
  onUpdateAmount: (id: string, amount: number) => void;
  onDelete: (id: string) => void;
}) {
  const [value, setValue] = useState(line.amount);

  // Sync external updates (e.g. after refetch)
  useEffect(() => {
    setValue(line.amount);
  }, [line.amount]);

  const commit = () => {
    const num = Number(value);
    if (isNaN(num) || num < 0) {
      setValue(line.amount);
      return;
    }
    if (num.toString() !== Number(line.amount).toString()) {
      onUpdateAmount(line.id, num);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xs font-semibold">
          {line.personName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm text-gray-700">{line.personName}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-28 text-right text-sm bg-white border border-gray-200 rounded px-2 py-1 focus:border-blue-400 focus:outline-none"
        />
        <span className="text-xs text-gray-500">FCFA</span>
        <button
          onClick={() => {
            if (confirm(`Supprimer ${line.personName} de ce bloc ?`)) {
              onDelete(line.id);
            }
          }}
          className="text-gray-400 hover:text-red-500 transition-colors"
          title="Supprimer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ─── AddProjectButton ───────────────────────────────────────

function AddProjectButton({
  availableProjects,
  onAdd,
}: {
  availableProjects: Project[];
  onAdd: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
      >
        + Ajouter un projet
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) {
            onAdd(e.target.value);
            setOpen(false);
          }
        }}
        className="flex-1 bg-white border border-dashed border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:border-blue-400 focus:outline-none"
        autoFocus
      >
        <option value="" disabled>
          -- Sélectionner un projet --
        </option>
        {availableProjects
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
      <button
        onClick={() => setOpen(false)}
        className="text-xs text-gray-500 hover:text-gray-700 px-2"
      >
        Annuler
      </button>
    </div>
  );
}

