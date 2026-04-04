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

  // Sync from props when they change
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

  return (
    <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 space-y-3">
      {/* Project dropdown */}
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">
          Projet
        </label>
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="input !py-1.5 !text-sm"
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
        <label className="text-xs font-medium text-gray-500 block mb-1">
          Répartition par personne
        </label>

        {allocations.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {allocations.map((alloc) => (
              <div key={alloc.name} className="flex items-center gap-2">
                <span className="text-sm text-gray-700 w-28 truncate">
                  {alloc.name}
                </span>
                <input
                  type="number"
                  value={alloc.amount || ""}
                  onChange={(e) =>
                    updateAmount(alloc.name, parseInt(e.target.value) || 0)
                  }
                  placeholder="Montant"
                  className="input !py-1 !text-sm flex-1"
                />
                <button
                  onClick={() => removePerson(alloc.name)}
                  className="text-red-400 hover:text-red-600 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="flex justify-between text-xs mt-1">
              <span className="text-gray-500">
                Total: {formatCFA(totalAllocated)}
              </span>
              {remaining !== 0 && (
                <span className={remaining > 0 ? "text-orange-500" : "text-red-500"}>
                  {remaining > 0 ? `Reste: ${formatCFA(remaining)}` : `Dépassement: ${formatCFA(Math.abs(remaining))}`}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Add person */}
        <div className="flex items-center gap-2">
          {availablePersons && availablePersons.length > 0 && (
            <select
              onChange={(e) => {
                if (e.target.value) addPerson(e.target.value);
                e.target.value = "";
              }}
              className="input !py-1 !text-sm flex-1"
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
            className="text-xs text-pine hover:text-pine-hover whitespace-nowrap"
          >
            + Manuel
          </button>
        </div>

        {/* Manual person input */}
        {showAddManual && (
          <div className="flex items-center gap-2 mt-1.5">
            <input
              type="text"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="Nom de la personne"
              className="input !py-1 !text-sm flex-1"
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
              className="text-xs bg-pine text-white px-3 py-1 rounded-lg hover:bg-pine-hover disabled:opacity-50"
            >
              OK
            </button>
          </div>
        )}
      </div>

      {/* Save button */}
      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="btn-primary w-full !py-2 text-sm"
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
  );
}
