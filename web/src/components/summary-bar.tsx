import { formatCFA } from "../lib/format";

interface Props {
  summary: {
    totalWaveReconciled: number;
    totalCashReconciled: number;
    invoicesReconciled: number;
  };
  invoiceCount: number;
}

export function SummaryBar({ summary, invoiceCount }: Props) {
  const percent =
    invoiceCount > 0
      ? Math.round((summary.invoicesReconciled / invoiceCount) * 100)
      : 0;

  return (
    <div className="bg-white border-t px-4 py-2 flex items-center justify-between text-sm flex-shrink-0">
      <div className="flex gap-4">
        <div>
          <span className="text-gray-500">Wave : </span>
          <span className="font-medium text-gray-900">
            {formatCFA(summary.totalWaveReconciled)}
          </span>
        </div>
        <div>
          <span className="text-gray-500">Espèces : </span>
          <span className="font-medium text-gray-900">
            {formatCFA(summary.totalCashReconciled)}
          </span>
        </div>
      </div>
      <div className="text-gray-500">
        <span className="font-medium text-gray-900">
          {summary.invoicesReconciled}/{invoiceCount}
        </span>{" "}
        factures ({percent}%)
      </div>
    </div>
  );
}
