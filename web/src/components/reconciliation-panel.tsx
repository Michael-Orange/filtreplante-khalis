import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCFA, formatDateShort } from "../lib/format";

interface WaveTransaction {
  id: string;
  transactionId: string;
  transactionDate: string;
  amount: string;
  counterpartyName: string | null;
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
}

interface Props {
  invoice: {
    id: string;
    supplierName: string | null;
    amount: number;
    paidInFacture: number;
    remainingDue: number;
    reconciledWave: number;
    reconciledCash: number;
    reconciledTotal: number;
    paymentType: string;
    invoiceDate: string;
    description: string;
    category: string;
    invoiceType: string | null;
  };
  sessionId: string;
  waveTransactions: WaveTransaction[];
  onBack: () => void;
  onChanged: () => void;
}

export function ReconciliationPanel({
  invoice,
  sessionId,
  waveTransactions,
  onBack,
  onChanged,
}: Props) {
  const [cashInput, setCashInput] = useState("");
  const queryClient = useQueryClient();

  const { data: links } = useQuery({
    queryKey: ["links", sessionId, invoice.id],
    queryFn: () =>
      api.get<ReconciliationLink[]>(
        `/api/reconcile/${sessionId}/${invoice.id}`
      ),
  });

  const linkMutation = useMutation({
    mutationFn: (data: {
      waveTransactionId?: string;
      cashAmount: number;
    }) =>
      api.post("/api/reconcile", {
        sessionId,
        invoiceId: invoice.id,
        ...data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["links", sessionId, invoice.id],
      });
      onChanged();
      setCashInput("");
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: string) => api.delete(`/api/reconcile/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["links", sessionId, invoice.id],
      });
      onChanged();
    },
  });

  // Wave transactions already linked (in any invoice of this session)
  const linkedWaveIds = new Set(
    links?.filter((l) => l.waveTransactionId).map((l) => l.waveTransactionId) || []
  );

  const toReconcile =
    invoice.remainingDue - invoice.reconciledTotal;

  // Link a full Wave transaction (indivisible)
  const handleLinkWave = (waveId: string) => {
    linkMutation.mutate({
      waveTransactionId: waveId,
      cashAmount: 0,
    });
  };

  const handleAddCash = () => {
    const amount = parseInt(cashInput) || 0;
    if (amount <= 0) return;
    linkMutation.mutate({ cashAmount: amount });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Invoice header */}
      <div className="bg-white border-b px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={onBack}
            className="lg:hidden text-gray-400 hover:text-gray-600"
          >
            &larr;
          </button>
          <h3 className="font-heading font-semibold text-gray-900">
            {invoice.supplierName || "—"}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-gray-500">Montant :</span>{" "}
            <span className="font-medium">{formatCFA(invoice.amount)}</span>
          </div>
          <div>
            <span className="text-gray-500">Type :</span>{" "}
            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
              {invoice.paymentType}
            </span>
          </div>
          {invoice.paidInFacture > 0 && invoice.paidInFacture < invoice.amount && (
            <>
              <div>
                <span className="text-gray-500">Déjà payé :</span>{" "}
                <span className="text-orange-600">
                  {formatCFA(invoice.paidInFacture)}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Reste dû :</span>{" "}
                <span className="font-medium">
                  {formatCFA(invoice.remainingDue)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Progress */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Rapproché</span>
            <span>
              {formatCFA(invoice.reconciledTotal)} / {formatCFA(invoice.remainingDue || invoice.amount)}
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                toReconcile <= 0 ? "bg-green-500" : "bg-orange-400"
              }`}
              style={{
                width: `${Math.min(100, (invoice.reconciledTotal / (invoice.remainingDue || invoice.amount)) * 100)}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Already linked */}
        {links && links.length > 0 && (
          <div className="px-4 py-3 border-b">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
              Paiements liés
            </h4>
            <div className="space-y-2">
              {links.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2"
                >
                  <div className="text-sm">
                    {parseFloat(link.waveAmount) > 0 && (
                      <div className="text-green-700">
                        Wave {formatCFA(parseFloat(link.waveAmount))}
                        {link.waveCounterparty && (
                          <span className="text-green-500 text-xs ml-1">
                            ({link.waveCounterparty})
                          </span>
                        )}
                        {link.waveDate && (
                          <span className="text-green-500 text-xs ml-1">
                            · {formatDateShort(link.waveDate)}
                          </span>
                        )}
                      </div>
                    )}
                    {parseFloat(link.cashAmount) > 0 && (
                      <div className="text-green-700">
                        Espèces {formatCFA(parseFloat(link.cashAmount))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => unlinkMutation.mutate(link.id)}
                    disabled={unlinkMutation.isPending}
                    className="text-red-400 hover:text-red-600 text-xs font-medium"
                  >
                    Délier
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error message */}
        {linkMutation.isError && (
          <div className="px-4 py-2 bg-red-50 border-b">
            <p className="text-red-600 text-sm">
              {(linkMutation.error as any)?.message || "Erreur"}
            </p>
          </div>
        )}

        {/* Available wave transactions */}
        {toReconcile > 0 && (
          <div className="px-4 py-3">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
              Transactions Wave disponibles
            </h4>
            <div className="space-y-1">
              {waveTransactions
                .sort((a, b) => {
                  const invDate = new Date(invoice.invoiceDate).getTime();
                  const dateA = new Date(a.transactionDate).getTime();
                  const dateB = new Date(b.transactionDate).getTime();
                  return (
                    Math.abs(dateA - invDate) - Math.abs(dateB - invDate)
                  );
                })
                .map((wave) => (
                  <div
                    key={wave.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50 border border-gray-100"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900">
                        {formatCFA(parseFloat(wave.amount))}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {formatDateShort(wave.transactionDate)}
                        {wave.counterpartyName && ` · ${wave.counterpartyName}`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleLinkWave(wave.id)}
                      disabled={linkMutation.isPending}
                      className="text-xs text-pine font-medium hover:text-pine-hover whitespace-nowrap ml-2"
                    >
                      Lier
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Cash input */}
        {toReconcile > 0 && (
          <div className="px-4 py-3 border-t">
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
              Paiement espèces
            </h4>
            <div className="flex gap-2">
              <input
                type="number"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder="Montant espèces"
                className="input !py-2 flex-1"
              />
              <button
                onClick={handleAddCash}
                disabled={!cashInput || linkMutation.isPending}
                className="btn-secondary text-sm !px-4 !py-2 !min-h-0"
              >
                Ajouter
              </button>
            </div>
          </div>
        )}

        {/* Fully reconciled */}
        {toReconcile <= 0 && (
          <div className="px-4 py-8 text-center">
            <div className="text-green-500 text-3xl mb-2">✓</div>
            <p className="text-green-700 font-medium">Facture rapprochée</p>
          </div>
        )}
      </div>
    </div>
  );
}
