import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "../lib/api";
import { formatCFA, formatDateShort } from "../lib/format";
import { useToast } from "../lib/toast";
import { consolidateFactures } from "../lib/consolidate";
import { computeAutoLinks, type LinkedWaveEntry } from "../lib/auto-link";
import { CashProjectBlock, AddProjectButton } from "./cash-project-block";
import type {
  WaveTransaction,
  CashAllocation,
  Project,
} from "../types/khalis";

// ─── Khalis Data Tab ───────────────────────────────────────────────
// Composant unique monté pour les 2 onglets "Rapprochement Caisse" et
// "Résumé" (cf. CLAUDE.md § architecture 3 onglets). Le prop `view`
// décide quelles sections rendre ; le composant reste monté pour
// préserver les queries et le state local entre les 2 vues.

export function KhalisDataTab({
  waves,
  sessionId,
  view,
}: {
  waves: WaveTransaction[];
  sessionId: string;
  view: "cash-editor" | "resume";
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
    staleTime: 60_000,
  });
  const cashAllocations = cashQuery.data ?? [];

  const personsQuery = useQuery({
    queryKey: ["persons"],
    queryFn: () => api.get<{ name: string }[]>("/api/metadata/persons"),
    staleTime: 5 * 60_000,
  });
  const persons = personsQuery.data ?? [];

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

  const { toast } = useToast();

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
    onSuccess: () => {
      toast("✓ Personne ajoutée");
      invalidateCash();
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

  const updateCashMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.patch<CashAllocation>(`/api/cash/${id}`, { amount }),
    onSuccess: () => {
      toast("✓ Enregistré");
      invalidateCash();
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

  const deleteCashLineMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/cash/${id}`),
    onSuccess: () => {
      toast("✓ Supprimé");
      invalidateCash();
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

  const deleteCashBlockMutation = useMutation({
    mutationFn: (projectId: string) =>
      api.delete(`/api/cash/session/${sessionId}/project/${projectId}`),
    onSuccess: () => {
      toast("✓ Bloc supprimé");
      invalidateCash();
    },
    onError: (err) => toast(getErrorMessage(err), "error"),
  });

  // Build summary from wave metadata
  const wavesWithMeta = waves.filter(
    (w) => w.projectId || (w.allocations && w.allocations.length > 0),
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

  // Per-person summary across cash allocations (flat, all projects merged)
  const cashPersonTotals = new Map<string, number>();
  for (const c of cashAllocations) {
    cashPersonTotals.set(
      c.personName,
      (cashPersonTotals.get(c.personName) || 0) + Number(c.amount),
    );
  }
  const cashGrandTotal = Array.from(cashPersonTotals.values()).reduce(
    (s, a) => s + a,
    0,
  );

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
    ]),
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
    // Exclure les projets déjà présents comme bloc ET les projets terminés
    // (cohérent avec le chevron wave qui masque les terminés sauf le courant)
    (p) => !blockProjectIds.includes(p.id) && !p.isCompleted,
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

  // ─── Matrice brute person × projet (wave + cash) ─────────────
  // Sert d'entrée à la consolidation. "__none__" est inclus mais gelé
  // (ses cellules ne bougent pas) pour que Fatou garde ses waves sans
  // projet visibles en tant que rappel.
  const rawCells = new Map<string, Map<string, number>>();
  for (const [pid, g] of projectMap) {
    for (const [personName, entry] of g.persons) {
      if (!rawCells.has(personName)) rawCells.set(personName, new Map());
      const row = rawCells.get(personName)!;
      row.set(pid, (row.get(pid) || 0) + entry.amount);
    }
  }
  for (const c of cashAllocations) {
    if (!rawCells.has(c.personName)) rawCells.set(c.personName, new Map());
    const row = rawCells.get(c.personName)!;
    row.set(c.projectId, (row.get(c.projectId) || 0) + Number(c.amount));
  }

  // Lookup nom de projet par id (pour l'affichage)
  const projectNameById = new Map<string, string>();
  for (const [pid, g] of projectMap) projectNameById.set(pid, g.projectName);
  for (const c of cashAllocations) {
    if (!projectNameById.has(c.projectId)) {
      projectNameById.set(
        c.projectId,
        projects?.find((p) => p.id === c.projectId)?.name || "Projet inconnu",
      );
    }
  }

  // Consolide la matrice pour minimiser le nombre de factures à générer
  // (cf. consolidateFactures). "__none__" est gelé → ses cellules restent.
  const factureMatrix = consolidateFactures(
    rawCells,
    new Set(["__none__"]),
  );

  // ─── Étape 3 — Liaisons wave → facture d'équipe ──────────────
  // Compute inline a chaque render. Simple et garanti toujours frais.
  // Le bouton "Recalculer" force juste un re-render (utile en UX mais
  // pas nécessaire pour la correction).
  const [, forceRerender] = useState(0);
  const { linkedByFactureKey, totalWaveUnlinked } = computeAutoLinks(
    wavesWithMeta,
    factureMatrix,
  );

  const handleRefreshLinks = () => {
    forceRerender((v) => v + 1);
  };

  // ─── Merged project map pour la section 3 ─────────────────────
  // Construit depuis la matrice consolidée : chaque cellule non-nulle
  // est une facture d'équipe à générer. Les détails wave/caisse par
  // cellule disparaissent (le breakdown existe au niveau global via
  // le bandeau récap).
  type MergedPerson = {
    total: number;
    linkedWaves: LinkedWaveEntry[];
    factureDate: string | null; // min des dates des waves auto-liés
  };
  const mergedProjectMap = new Map<string, {
    projectName: string;
    persons: Map<string, MergedPerson>;
    projectTotal: number;
  }>();

  for (const [personName, row] of factureMatrix) {
    for (const [projectId, amount] of row) {
      if (amount <= 0) continue;
      if (!mergedProjectMap.has(projectId)) {
        mergedProjectMap.set(projectId, {
          projectName: projectNameById.get(projectId) || "Projet inconnu",
          persons: new Map(),
          projectTotal: 0,
        });
      }
      const entry = mergedProjectMap.get(projectId)!;
      const factureKey = `${projectId}|${personName}`;
      const linked = linkedByFactureKey.get(factureKey) || [];
      const factureDate = linked.reduce<string | null>(
        (min, w) => (min === null || w.date < min ? w.date : min),
        null,
      );
      entry.persons.set(personName, {
        total: amount,
        linkedWaves: linked,
        factureDate,
      });
      entry.projectTotal += amount;
    }
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
      {/* Section 1 — Réglements wave par personne (vue Résumé uniquement) */}
      {view === "resume" && (
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
      )}

      {/* Réglements caisse par personne — liste plate (vue Résumé uniquement) */}
      {view === "resume" && cashPersonTotals.size > 0 && (
        <div className="p-4 pt-0">
          <h3 className="font-heading font-semibold text-gray-900 mb-3">
            Réglements caisse par personne
          </h3>
          <div className="bg-white rounded-xl border border-gray-200 divide-y">
            {Array.from(cashPersonTotals.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([name, amount]) => (
                <div key={name} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-sm font-semibold">
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
              <span className="text-sm font-bold text-gray-900">{formatCFA(cashGrandTotal)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Section 2 — Réglements Caisse Fatou par personne (vue Rapprochement Caisse uniquement) */}
      {view === "cash-editor" && (
        <div className="p-4">
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
                    prev.includes(projectId) ? prev : [...prev, projectId],
                  )
                }
              />
            )}
          </div>
        </div>
      )}

      {/* Section 3 — Facture par projet et par personne (vue Résumé uniquement) */}
      {view === "resume" && (
        <div className="p-4 pt-0">
          {(() => {
            const totalWaveRFE = waveGrandTotal;
            const totalCashRFE = cashAllocations.reduce(
              (s, c) => s + Number(c.amount),
              0,
            );
            const totalFactures = Array.from(mergedProjectMap.values()).reduce(
              (s, g) => s + g.projectTotal,
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
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-heading font-semibold text-gray-900 flex items-center gap-1.5">
              Facture par projet et par personne
              <span
                className="text-[10px] font-normal uppercase tracking-wide bg-pine-light text-pine px-1.5 py-0.5 rounded cursor-help"
                title="Matrice optimisée : les montants par personne × projet sont automatiquement rééquilibrés pour réduire le nombre de factures à générer, tout en préservant les totaux par personne et par projet. Vos saisies brutes (chevrons wave et onglet Rapprochement Caisse) ne sont pas modifiées."
              >
                consolidée
              </span>
            </h3>
            <button
              type="button"
              onClick={handleRefreshLinks}
              className="cursor-pointer flex items-center gap-1.5 text-xs text-white bg-pine hover:bg-pine-hover active:scale-95 px-3 py-1.5 rounded-lg font-medium transition-all"
              aria-label="Recalculer les liaisons"
              title="Recalcule les liaisons entre règlements wave et factures à partir des données actuelles"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Recalculer les liaisons
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Les montants ci-dessous sont optimisés pour minimiser le nombre de factures à créer.
          </p>
          <div className="space-y-3">
            {Array.from(mergedProjectMap.entries()).map(([projId, group]) => {
              const projectTotal = group.projectTotal;
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
                        total: amounts.total,
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
      )}
    </div>
  );
}
