import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCFA } from "../lib/format";

interface Project {
  id: string;
  number: string;
  name: string;
  isCompleted: boolean | null;
}

interface Person {
  name: string;
}

interface Allocation {
  name: string;
  amount: number;
}

interface Props {
  waveId: string;
  waveAmount: number;
  currentProjectId: string | null;
  currentAllocations: Allocation[];
  onChanged: () => void;
}

export function WaveMetadata({
  waveId,
  waveAmount,
  currentProjectId,
  currentAllocations,
  onChanged,
}: Props) {
  const queryClient = useQueryClient();

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/api/metadata/projects"),
    staleTime: 5 * 60_000,
  });

  const { data: persons } = useQuery({
    queryKey: ["persons"],
    queryFn: () => api.get<Person[]>("/api/metadata/persons"),
    staleTime: 5 * 60_000,
  });

  const [projectId, setProjectId] = useState(currentProjectId || "");
  const [allocations, setAllocations] = useState<Allocation[]>(
    currentAllocations.length > 0 ? currentAllocations : []
  );
  const [manualName, setManualName] = useState("");
  const [showAddManual, setShowAddManual] = useState(false);

  useEffect(() => {
    setProjectId(currentProjectId || "");
    setAllocations(currentAllocations.length > 0 ? currentAllocations : []);
  }, [currentProjectId, currentAllocations]);

  const saveMutation = useMutation({
    mutationFn: (data: { projectId: string | null; allocations: Allocation[] }) =>
      api.patch(`/api/metadata/transactions/${waveId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session"] });
      onChanged();
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      projectId: projectId || null,
      allocations: allocations.filter((a) => a.amount > 0),
    });
  };

  const addPerson = (name: string) => {
    if (allocations.some((a) => a.name === name)) return;
    setAllocations([...allocations, { name, amount: 0 }]);
  };

  const removePerson = (name: string) => {
    setAllocations(allocations.filter((a) => a.name !== name));
  };

  const updateAmount = (name: string, amount: number) => {
    setAllocations(
      allocations.map((a) => (a.name === name ? { ...a, amount } : a))
    );
  };

  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
  const remaining = waveAmount - totalAllocated;

  const hasChanges =
    projectId !== (currentProjectId || "") ||
    JSON.stringify(allocations) !== JSON.stringify(currentAllocations);

  const availablePersons = persons?.filter(
    (p) => !allocations.some((a) => a.name === p.name)
  );

  const selectedProject = projects?.find((p) => p.id === projectId);

  return (
    <div className="border-t border-l-4 border-l-blue-400 border-t-gray-200 bg-gradient-to-r from-blue-50/50 to-white">
      <div className="px-4 py-3 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            Détails de la dépense
          </span>
        </div>

        {/* Project */}
        <div>
          <label className="text-xs text-gray-500 block mb-1">Projet</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 focus:outline-none"
          >
            <option value="">-- Aucun --</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isCompleted ? " (terminé)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Allocations */}
        <div>
          <label className="text-xs text-gray-500 block mb-2">Répartition</label>

          {allocations.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100 mb-2">
              {allocations.map((alloc) => (
                <div key={alloc.name} className="flex items-center gap-2 px-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {alloc.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm text-gray-700 flex-shrink-0 w-24 truncate">
                    {alloc.name}
                  </span>
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      value={alloc.amount || ""}
                      onChange={(e) =>
                        updateAmount(alloc.name, parseInt(e.target.value) || 0)
                      }
                      placeholder="0"
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-right focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => removePerson(alloc.name)}
                    className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
              {/* Total row */}
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50/50">
                <span className="text-xs font-medium text-gray-500">Total</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCFA(totalAllocated)}
                  </span>
                  {remaining > 0 && allocations.length > 0 && (
                    <span className="text-xs text-orange-500 font-medium">
                      reste {formatCFA(remaining)}
                    </span>
                  )}
                  {remaining < 0 && (
                    <span className="text-xs text-red-500 font-medium">
                      +{formatCFA(Math.abs(remaining))}
                    </span>
                  )}
                  {remaining === 0 && allocations.length > 0 && (
                    <span className="text-xs text-green-600">✓</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Add person controls */}
          <div className="flex items-center gap-2">
            {availablePersons && availablePersons.length > 0 && (
              <select
                onChange={(e) => {
                  if (e.target.value) addPerson(e.target.value);
                  e.target.value = "";
                }}
                className="flex-1 bg-white border border-dashed border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-500 focus:border-blue-400 focus:outline-none"
                defaultValue=""
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
              onClick={() => setShowAddManual(!showAddManual)}
              className="text-xs text-blue-500 hover:text-blue-700 whitespace-nowrap font-medium"
            >
              + Autre
            </button>
          </div>

          {showAddManual && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nom"
                className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
                autoFocus
              />
              <button
                onClick={() => {
                  if (manualName.trim()) {
                    addPerson(manualName.trim());
                    setManualName("");
                    setShowAddManual(false);
                  }
                }}
                disabled={!manualName.trim()}
                className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                OK
              </button>
            </div>
          )}
        </div>

        {/* Save */}
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="w-full bg-blue-500 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {saveMutation.isPending ? "Enregistrement..." : "Enregistrer"}
          </button>
        )}
        {saveMutation.isError && (
          <p className="text-red-500 text-xs">
            {(saveMutation.error as any)?.message || "Erreur"}
          </p>
        )}
      </div>
    </div>
  );
}
