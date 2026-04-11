import { formatCFA, formatDateShort } from "../lib/format";
import { WaveMetadata } from "./wave-metadata";
import type { WaveTransaction, WaveLinkEntry } from "../types/khalis";

// ─── Wave row ──────────────────────────────────────────────────
// Une ligne de la liste des waves (onglet Rapprochement Wave, panel
// gauche). Affiche le montant, la date, les factures liées, un badge
// RFE et un chevron d'expansion qui monte `WaveMetadata`.

export function WaveRow({
  wave,
  isSelected,
  isExpanded,
  wLinks,
  sessionPersonNames,
  onSelect,
  onToggleExpand,
  onChanged,
}: {
  wave: WaveTransaction;
  isSelected: boolean;
  isExpanded: boolean;
  wLinks: WaveLinkEntry[];
  sessionPersonNames: string[];
  onSelect: () => void;
  onToggleExpand: () => void;
  onChanged: () => void;
}) {
  const isLinked = wLinks.length > 0;
  const totalAllocated = wLinks.reduce((s, l) => s + l.waveAmount, 0);
  const waveAmt = parseFloat(wave.amount);
  const hasUnusedCredit = isLinked && waveAmt > totalAllocated + 1;
  const hasMetadata = wave.projectId || (wave.allocations && wave.allocations.length > 0);

  return (
    <div>
      <div
        className={`flex items-center gap-3 ${
          isSelected ? "bg-pine-light" : ""
        }`}
      >
        {/* Status indicator */}
        <div
          className={`w-1.5 self-stretch rounded-full flex-shrink-0 ml-1 ${
            hasUnusedCredit ? "bg-orange-400" : isLinked ? "bg-green-500" : "bg-gray-300"
          }`}
        />
        <button
          onClick={onSelect}
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
                Règlement facture d'équipe
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
            onToggleExpand();
          }}
          className={`text-gray-300 hover:text-pine p-2 flex-shrink-0 transition-colors ${isExpanded ? "text-pine" : ""}`}
          aria-label={isExpanded ? "Fermer les détails" : "Voir les détails"}
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
          sessionPersonNames={sessionPersonNames}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}
