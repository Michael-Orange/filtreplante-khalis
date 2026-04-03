import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatCFA } from "../lib/format";

interface Props {
  sessionId: string;
  onImported: () => void;
}

interface ImportResult {
  imported: number;
  duplicates: number;
  skipped: number;
  warnings: string[];
}

export function CsvUpload({ sessionId, onImported }: Props) {
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [preview, setPreview] = useState<
    { date: string; amount: number; name: string }[]
  >([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: () =>
      api.post<ImportResult>(`/api/sessions/${sessionId}/import-wave`, {
        csvContent,
      }),
    onSuccess: (result) => {
      if (result.imported > 0) {
        onImported();
      }
    },
  });

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvContent(text);
      setFileName(file.name);

      // Quick preview parse
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const rows: { date: string; amount: number; name: string }[] = [];
      for (let i = 1; i < lines.length && rows.length < 100; i++) {
        const cols = lines[i].split(",");
        const amount = parseFloat(cols[3]?.trim() || "0");
        if (amount >= 0) continue; // Skip deposits
        rows.push({
          date: cols[0]?.trim() || "",
          amount: Math.abs(amount),
          name: cols[4]?.trim() || "—",
        });
      }
      setPreview(rows);
    };
    reader.readAsText(file, "utf-8");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  if (importMutation.isSuccess && importMutation.data.imported > 0) {
    return (
      <div className="p-4">
        <div className="card bg-green-50 border-green-200">
          <p className="text-green-700 font-medium">
            {importMutation.data.imported} transactions importées
          </p>
          {importMutation.data.skipped > 0 && (
            <p className="text-sm text-green-600 mt-1">
              {importMutation.data.skipped} dépôts/appros ignorés
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {!csvContent ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          className="card border-2 border-dashed border-gray-300 hover:border-pine cursor-pointer text-center py-12 transition-colors"
        >
          <p className="text-gray-600 font-medium mb-1">
            Importer le CSV Wave Business
          </p>
          <p className="text-sm text-gray-400">
            Glissez le fichier ici ou cliquez pour parcourir
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleChange}
            className="hidden"
          />
        </div>
      ) : (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="font-medium text-gray-900">{fileName}</p>
              <p className="text-sm text-gray-500">
                {preview.length} paiements détectés ·{" "}
                {formatCFA(preview.reduce((s, r) => s + r.amount, 0))} total
              </p>
            </div>
            <button
              onClick={() => {
                setCsvContent(null);
                setPreview([]);
              }}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Annuler
            </button>
          </div>

          {/* Preview table */}
          <div className="max-h-60 overflow-y-auto border rounded-lg mb-3">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">
                    Date
                  </th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">
                    Bénéficiaire
                  </th>
                  <th className="text-right px-3 py-2 text-gray-600 font-medium">
                    Montant
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 text-gray-600">{row.date}</td>
                    <td className="px-3 py-1.5 text-gray-900 truncate max-w-[200px]">
                      {row.name}
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium">
                      {formatCFA(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending}
            className="btn-primary w-full"
          >
            {importMutation.isPending
              ? "Import en cours..."
              : `Confirmer l'import (${preview.length} transactions)`}
          </button>

          {importMutation.isError && (
            <p className="text-red-500 text-sm mt-2">
              {(importMutation.error as any)?.message || "Erreur d'import"}
            </p>
          )}

          {importMutation.data?.warnings?.length ? (
            <div className="mt-2 text-xs text-orange-600">
              {importMutation.data.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
