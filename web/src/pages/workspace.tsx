import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { api } from "../lib/api";
import { formatCFA, formatDate, formatDateShort } from "../lib/format";
import { CsvUpload } from "../components/csv-upload";
import { ReconciliationPanel } from "../components/reconciliation-panel";
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

type FilterType = "all" | "pending" | "partial" | "done";

export function WorkspacePage() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const sessionId = params.id!;
  const queryClient = useQueryClient();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.get<SessionDetail>(`/api/sessions/${sessionId}`),
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["invoices", sessionId],
    queryFn: () => api.get<InvoiceRow[]>(`/api/invoices/${sessionId}`),
    enabled: !!session,
  });

  const { data: summary } = useQuery({
    queryKey: ["summary", sessionId],
    queryFn: () => api.get<Summary>(`/api/summary/${sessionId}`),
    enabled: !!session,
  });

  const autoMatchMutation = useMutation({
    mutationFn: () =>
      api.post<{ suggestions: any[] }>(`/api/auto-match/${sessionId}`),
  });

  const hasWaves = session && session.waveTransactions.length > 0;

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    if (filter === "all") return invoices;
    return invoices.filter((inv) => inv.reconStatus === filter);
  }, [invoices, filter]);

  const selectedInvoice = invoices?.find((inv) => inv.id === selectedInvoiceId);

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["summary", sessionId] });
    queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
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
              onClick={() => autoMatchMutation.mutate()}
              disabled={autoMatchMutation.isPending}
              className="btn-secondary text-xs !px-3 !py-1.5 !min-h-0 !rounded-lg"
            >
              {autoMatchMutation.isPending ? "..." : "Suggestions auto"}
            </button>
          )}
        </div>
      </div>

      {/* Auto-match suggestions */}
      {autoMatchMutation.data && autoMatchMutation.data.suggestions.length > 0 && (
        <AutoMatchBanner
          suggestions={autoMatchMutation.data.suggestions}
          sessionId={sessionId}
          onApplied={invalidateAll}
        />
      )}

      {/* CSV Upload if no waves yet */}
      {!hasWaves && (
        <CsvUpload sessionId={sessionId} onImported={invalidateAll} />
      )}

      {/* Main content */}
      {hasWaves && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left panel — Invoices */}
          <div
            className={`${
              selectedInvoiceId ? "hidden lg:flex" : "flex"
            } flex-col flex-1 lg:max-w-[55%] border-r overflow-hidden`}
          >
            {/* Filter chips */}
            <div className="flex gap-2 px-4 py-2 border-b bg-gray-50 flex-shrink-0">
              {(
                [
                  ["all", "Tous"],
                  ["pending", "A faire"],
                  ["partial", "Partiels"],
                  ["done", "OK"],
                ] as [FilterType, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                    filter === key
                      ? "bg-pine text-white"
                      : "bg-white text-gray-600 border hover:border-pine/30"
                  }`}
                >
                  {label}
                  {key !== "all" && invoices && (
                    <span className="ml-1">
                      ({invoices.filter((inv) => inv.reconStatus === key).length})
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Invoice list */}
            <div className="flex-1 overflow-y-auto">
              {invoicesLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-3 border-pine border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredInvoices.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">
                  Aucune facture pour ce filtre
                </div>
              ) : (
                <div className="divide-y">
                  {filteredInvoices.map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => setSelectedInvoiceId(inv.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3 ${
                        selectedInvoiceId === inv.id ? "bg-pine-light" : ""
                      }`}
                    >
                      {/* Status indicator */}
                      <div
                        className={`w-1.5 h-10 rounded-full flex-shrink-0 ${
                          inv.reconStatus === "done"
                            ? "bg-green-500"
                            : inv.reconStatus === "partial"
                            ? "bg-orange-400"
                            : "bg-gray-300"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-sm text-gray-900 truncate">
                            {inv.supplierName || "—"}
                          </span>
                          <span className="font-medium text-sm text-gray-900 whitespace-nowrap">
                            {formatCFA(inv.remainingDue > 0 ? inv.remainingDue : inv.amount)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-xs text-gray-500 truncate">
                            {formatDateShort(inv.invoiceDate)} · {inv.paymentType}
                          </span>
                          {inv.paidInFacture > 0 && inv.paidInFacture < inv.amount && (
                            <span className="text-xs text-orange-500">
                              Reste {formatCFA(inv.remainingDue)}
                            </span>
                          )}
                        </div>
                        {inv.reconciledTotal > 0 && (
                          <div className="mt-1">
                            <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  inv.reconStatus === "done" ? "bg-green-500" : "bg-orange-400"
                                }`}
                                style={{
                                  width: `${Math.min(100, (inv.reconciledTotal / (inv.remainingDue || inv.amount)) * 100)}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right panel — Reconciliation */}
          <div
            className={`${
              selectedInvoiceId ? "flex" : "hidden lg:flex"
            } flex-col flex-1 overflow-hidden`}
          >
            {selectedInvoice ? (
              <ReconciliationPanel
                invoice={selectedInvoice}
                sessionId={sessionId}
                waveTransactions={session.waveTransactions}
                onBack={() => setSelectedInvoiceId(null)}
                onChanged={invalidateAll}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                Sélectionnez une facture pour la rapprocher
              </div>
            )}
          </div>
        </div>
      )}

      {/* Orphan waves alert */}
      {summary && summary.orphanWaveCount > 0 && (
        <div className="bg-red-50 border-t border-red-200 px-4 py-2 flex-shrink-0">
          <div className="flex items-center gap-2 text-red-700 text-sm font-medium">
            <span>⚠</span>
            <span>
              {summary.orphanWaveCount} transaction{summary.orphanWaveCount > 1 ? "s" : ""} Wave
              non rapprochée{summary.orphanWaveCount > 1 ? "s" : ""} ({formatCFA(summary.orphanWaveTotal)})
            </span>
          </div>
        </div>
      )}

      {/* Summary bar */}
      {summary && <SummaryBar summary={summary} invoiceCount={invoices?.length || 0} />}
    </div>
  );
}

// Auto-match suggestions banner
function AutoMatchBanner({
  suggestions,
  sessionId,
  onApplied,
}: {
  suggestions: any[];
  sessionId: string;
  onApplied: () => void;
}) {
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const queryClient = useQueryClient();

  const applyMutation = useMutation({
    mutationFn: (suggestion: any) =>
      api.post("/api/reconcile", {
        sessionId,
        invoiceId: suggestion.invoiceId,
        waveTransactionId: suggestion.waveTransactionId,
        waveAmount: suggestion.waveAmount,
        cashAmount: 0,
      }),
    onSuccess: () => {
      onApplied();
    },
  });

  const handleApply = async (suggestion: any, index: number) => {
    await applyMutation.mutateAsync(suggestion);
    setApplied((prev) => new Set(prev).add(index));
  };

  const handleApplyAll = async () => {
    for (let i = 0; i < suggestions.length; i++) {
      if (!applied.has(i)) {
        await applyMutation.mutateAsync(suggestions[i]);
        setApplied((prev) => new Set(prev).add(i));
      }
    }
  };

  const remaining = suggestions.filter((_, i) => !applied.has(i));
  if (remaining.length === 0) return null;

  return (
    <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex-shrink-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-blue-800">
          {remaining.length} suggestion{remaining.length > 1 ? "s" : ""} de rapprochement
        </span>
        <button
          onClick={handleApplyAll}
          disabled={applyMutation.isPending}
          className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700"
        >
          Accepter tout
        </button>
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {suggestions.map((s, i) => (
          <div
            key={i}
            className={`flex items-center justify-between text-xs ${
              applied.has(i) ? "opacity-40" : ""
            }`}
          >
            <span className="text-blue-700">
              {s.supplierName} · {formatCFA(s.waveAmount)} · {formatDateShort(s.waveDate)}
              {s.confidence === "high" && " ★"}
            </span>
            {!applied.has(i) && (
              <button
                onClick={() => handleApply(s, i)}
                disabled={applyMutation.isPending}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                Accepter
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
