import { useState, useEffect } from "react";
import { formatCFA } from "../lib/format";
import type { CashAllocation, Project } from "../types/khalis";

// ─── CashProjectBlock ───────────────────────────────────────
// Bloc éditeur pour un projet donné : liste de CashLineRow + contrôle
// d'ajout de personne (dropdown + bouton "+ Autre" avec autocomplete).
// Utilisé dans l'onglet Rapprochement Caisse via KhalisDataTab.

export function CashProjectBlock({
  projectId: _projectId,
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
              aria-label="Supprimer le bloc"
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
          aria-label={`Supprimer ${line.personName}`}
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

export function AddProjectButton({
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
