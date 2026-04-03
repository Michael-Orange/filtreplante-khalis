import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";

interface Session {
  id: string;
  label: string;
  dateStart: string;
  dateEnd: string;
  status: string;
  createdBy: string;
  createdAt: string;
  waveCount: number;
  linkCount: number;
}

function getMonthOptions() {
  const options: { label: string; value: string; start: string; end: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const label = d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}`;
    options.push({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      value: `${year}-${month + 1}`,
      start,
      end,
    });
  }
  return options;
}

export function SessionsListPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const monthOptions = getMonthOptions();
  const [selectedMonth, setSelectedMonth] = useState(1);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.get<Session[]>("/api/sessions"),
  });

  const createMutation = useMutation({
    mutationFn: (data: { label: string; dateStart: string; dateEnd: string }) =>
      api.post<{ id: string }>("/api/sessions", data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate(`/sessions/${result.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const handleDelete = (e: React.MouseEvent, id: string, label: string) => {
    e.stopPropagation();
    if (confirm(`Supprimer la session "${label}" et tous ses rapprochements ?`)) {
      deleteMutation.mutate(id);
    }
  };

  const handleCreate = () => {
    const month = monthOptions[selectedMonth];
    createMutation.mutate({
      label: month.label,
      dateStart: month.start,
      dateEnd: month.end,
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-heading font-semibold text-xl text-gray-900">
          Sessions de rapprochement
        </h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-primary text-sm !px-4 !py-2 !min-h-0"
        >
          + Nouveau
        </button>
      </div>

      {showCreate && (
        <div className="card mb-6">
          <h3 className="font-heading font-medium text-gray-900 mb-3">
            Nouveau rapprochement
          </h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="text-sm text-gray-600 mb-1 block">Mois</label>
              <select
                className="input"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
              >
                {monthOptions.map((opt, i) => (
                  <option key={opt.value} value={i}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="btn-primary text-sm !px-4 !py-3"
            >
              {createMutation.isPending ? "..." : "Créer"}
            </button>
          </div>
          {createMutation.isError && (
            <p className="text-red-500 text-sm mt-2">
              {(createMutation.error as any)?.message || "Erreur"}
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-pine border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sessions && sessions.length > 0 ? (
        <div className="space-y-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/sessions/${s.id}`)}
              className="card w-full text-left hover:border-pine/30 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-heading font-medium text-gray-900">
                  {s.label}
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      s.status === "termine"
                        ? "bg-green-100 text-green-700"
                        : "bg-orange-100 text-orange-700"
                    }`}
                  >
                    {s.status === "termine" ? "Terminé" : "En cours"}
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, s.id, s.label)}
                    disabled={deleteMutation.isPending}
                    className="text-gray-300 hover:text-red-500 transition-colors p-1"
                    title="Supprimer"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  </button>
                </div>
              </div>
              <div className="text-sm text-gray-500">
                {formatDate(s.dateStart)} — {formatDate(s.dateEnd)}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-400">
                <span>{s.waveCount} transactions Wave</span>
                <span>{s.linkCount} factures rapprochées</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-gray-400">
          <p className="mb-2">Aucune session de rapprochement</p>
          <p className="text-sm">
            Cliquez sur "+ Nouveau" pour commencer
          </p>
        </div>
      )}
    </div>
  );
}
