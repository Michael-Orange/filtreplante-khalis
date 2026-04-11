import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api, getErrorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { useToast } from "../lib/toast";
import { CsvUpload } from "../components/csv-upload";
import { SummaryBar } from "../components/summary-bar";
import { WaveLinkPanel } from "../components/wave-link-panel";
import { WaveRow } from "../components/wave-row";
import { KhalisDataTab } from "../components/khalis-data-tab";
import type {
  SessionDetail,
  CashAllocation,
  InvoiceRow,
  ReconciliationLink,
  Summary,
  WaveFilter,
  WaveLinkEntry,
} from "../types/khalis";

// ─── WorkspacePage ─────────────────────────────────────────────────
// Page principale — orchestrateur. Charge la session, les factures, les
// liens de rapprochement et les cash allocations, puis délègue le rendu
// aux 3 onglets via WaveRow/WaveLinkPanel (Rapprochement Wave) et
// KhalisDataTab (Rapprochement Caisse + Résumé).

export function WorkspacePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const sessionId = params.id!;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(null);
  const [expandedWaveId, setExpandedWaveId] = useState<string | null>(null);
  const [waveFilter, setWaveFilter] = useState<WaveFilter>("all");
  const [activeTab, setActiveTab] = useState<
    "rapprochement-wave" | "rapprochement-caisse" | "resume"
  >("rapprochement-wave");

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

  // Cash allocations à ce niveau pour les partager avec WaveMetadata
  // (autocomplete des noms déjà saisis manuellement dans la session,
  // que ce soit en chevron wave OU en rapprochement caisse).
  const { data: cashAllocationsForSession } = useQuery({
    queryKey: ["cash", sessionId],
    queryFn: () => api.get<CashAllocation[]>(`/api/cash/${sessionId}`),
    staleTime: 60_000,
  });

  const hasWaves = session && session.waveTransactions.length > 0;
  const dataReady = hasWaves && !linksLoading && !!allLinks;

  // Build a map: waveId -> array of linked invoices (1 Wave can cover N invoices of same supplier)
  const waveToLinks = useMemo(() => {
    const map: Record<string, WaveLinkEntry[]> = {};
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

  // Factures fournisseur sans lien de rapprochement (ni wave ni cash).
  // Vient de l'app Facture de Fatou via /api/invoices/:sessionId.
  const unreconciledInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter((inv) => inv.reconStatus === "pending");
  }, [invoices]);

  // Waves non-RFE sans lien de rapprochement. Les RFE (wave avec
  // allocations chevron) sont exclus : ils ne se lient pas à des
  // factures fournisseur, leur affectation est gérée par l'auto-link
  // dans l'onglet Résumé.
  const unreconciledWaves = useMemo(() => {
    if (!session) return [];
    return session.waveTransactions.filter((w) => {
      const isRFE = !!w.allocations && w.allocations.length > 0;
      if (isRFE) return false;
      return !waveToLinks[w.id];
    });
  }, [session, waveToLinks]);

  // Tous les noms de personnes déjà utilisés dans la session (wave
  // chevrons + cash allocations), dédupliqués. Pour l'autocomplete du
  // chevron wave-metadata. Doit être avant les returns conditionnels.
  const sessionPersonNames = useMemo(() => {
    const set = new Set<string>();
    if (session) {
      for (const w of session.waveTransactions) {
        for (const a of w.allocations || []) set.add(a.name);
      }
    }
    for (const c of cashAllocationsForSession || []) set.add(c.personName);
    return Array.from(set);
  }, [session, cashAllocationsForSession]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["summary", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["allLinks", sessionId] });
  };

  // Auto-rapprochement : matche chaque wave non-RFE avec une ligne
  // facture.payments (Wave) ou une dépense one-shot Wave quand un
  // candidat unique existe (montant exact + date ±1j). Voir backend
  // routes/auto-match.ts pour le détail.
  const autoMatchMutation = useMutation({
    mutationFn: () =>
      api.post<{
        matched: number;
        ambiguous: number;
        unmatched: number;
        totalCandidates: number;
      }>(`/api/auto-match/${sessionId}`),
    onSuccess: (res) => {
      invalidateAll();
      if (res.totalCandidates === 0) {
        toast("Aucun règlement à rapprocher");
      } else if (res.matched === 0) {
        toast(
          `Aucun match automatique. ${res.ambiguous} ambigu${res.ambiguous > 1 ? "s" : ""}, ${res.unmatched} sans candidat.`,
        );
      } else {
        const parts = [`${res.matched} rapproché${res.matched > 1 ? "s" : ""}`];
        if (res.ambiguous > 0) parts.push(`${res.ambiguous} ambigu${res.ambiguous > 1 ? "s" : ""}`);
        if (res.unmatched > 0) parts.push(`${res.unmatched} sans candidat`);
        toast(`✓ ${parts.join(" · ")}`);
      }
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

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
            aria-label="Retour à la liste des sessions"
          >
            &larr;
          </button>
          <div>
            <h2 className="font-heading font-semibold text-gray-900 flex items-center gap-2">
              {session.label}
              {session.archived && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                  Archivée
                </span>
              )}
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
              aria-label="Rafraîchir les factures"
              title="Rafraîchir les factures"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Bannière session archivée — édition bloquée */}
      {session.archived && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center gap-2 flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0">
            <rect x="3" y="4" width="18" height="4" rx="1"/>
            <path d="M5 8v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>
            <line x1="10" y1="12" x2="14" y2="12"/>
          </svg>
          Session archivée — lecture seule. Désarchivez-la pour reprendre l'édition.
        </div>
      )}

      {/* Tabs */}
      {dataReady && (
        <div className="flex border-b bg-white flex-shrink-0">
          <button
            onClick={() => setActiveTab("rapprochement-wave")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "rapprochement-wave"
                ? "border-pine text-pine"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Rapprochement Wave
          </button>
          <button
            onClick={() => setActiveTab("rapprochement-caisse")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "rapprochement-caisse"
                ? "border-pine text-pine"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Rapprochement Caisse
          </button>
          <button
            onClick={() => setActiveTab("resume")}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "resume"
                ? "border-pine text-pine"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Résumé
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

      {/* Data tab — kept mounted across cash-editor <-> resume to preserve state */}
      {dataReady &&
        (activeTab === "rapprochement-caisse" || activeTab === "resume") && (
          <KhalisDataTab
            waves={session.waveTransactions}
            sessionId={sessionId}
            view={activeTab === "rapprochement-caisse" ? "cash-editor" : "resume"}
          />
        )}

      {/* Main content — Wave-centric view */}
      {dataReady && activeTab === "rapprochement-wave" && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel — Wave transactions */}
          <div
            className={`${
              selectedWaveId ? "hidden lg:flex" : "flex"
            } flex-col flex-1 lg:max-w-[55%] border-r overflow-hidden`}
          >
            {/* Filter chips + auto-match */}
            <div className="flex gap-2 px-4 py-2 border-b bg-gray-50 flex-shrink-0 items-center">
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
              <button
                onClick={() => autoMatchMutation.mutate()}
                disabled={autoMatchMutation.isPending}
                className="ml-auto text-xs px-3 py-1 rounded-full font-medium bg-pine text-white hover:bg-pine-hover disabled:opacity-50 transition-colors"
                title="Lier automatiquement les règlements Wave aux factures/dépenses Facture quand un unique candidat matche (montant exact + date ±1j)"
              >
                {autoMatchMutation.isPending ? "Rapprochement..." : "Auto-rapprocher"}
              </button>
            </div>

            {/* Wave transaction list */}
            <div className="flex-1 overflow-y-auto">
              {filteredWaves.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Aucune transaction pour ce filtre
                </div>
              ) : (
                <div className="divide-y">
                  {filteredWaves.map((wave) => (
                    <WaveRow
                      key={wave.id}
                      wave={wave}
                      isSelected={selectedWaveId === wave.id}
                      isExpanded={expandedWaveId === wave.id}
                      wLinks={waveToLinks[wave.id] || []}
                      sessionPersonNames={sessionPersonNames}
                      onSelect={() => setSelectedWaveId(wave.id)}
                      onToggleExpand={() =>
                        setExpandedWaveId(expandedWaveId === wave.id ? null : wave.id)
                      }
                      onChanged={invalidateAll}
                    />
                  ))}
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

      {/* Alerte rapprochement : waves non-RFE non liés + factures fournisseur pending */}
      {dataReady &&
        (unreconciledWaves.length > 0 || unreconciledInvoices.length > 0) && (
          <div className="bg-orange-50 border-t border-orange-200 px-4 py-2 flex-shrink-0 space-y-0.5">
            {unreconciledWaves.length > 0 && (
              <div className="text-orange-700 text-sm font-medium">
                {unreconciledWaves.length} règlement
                {unreconciledWaves.length > 1 ? "s" : ""} wave non rapproché
                {unreconciledWaves.length > 1 ? "s" : ""}
                <span className="text-orange-500 text-xs font-normal ml-1">
                  (hors règlements wave pour factures d'équipe)
                </span>
              </div>
            )}
            {unreconciledInvoices.length > 0 && (
              <div className="text-orange-700 text-sm font-medium">
                {unreconciledInvoices.length} facture
                {unreconciledInvoices.length > 1 ? "s" : ""} fournisseur non
                rapprochée{unreconciledInvoices.length > 1 ? "s" : ""}
              </div>
            )}
          </div>
        )}

      {/* Summary bar */}
      {summary && <SummaryBar summary={summary} invoiceCount={invoices?.length || 0} />}
    </div>
  );
}
