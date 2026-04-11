// Types partagés de l'app Khalis.
// Pas de dépendance React — peut être importé depuis lib/ ou components/.

export interface SessionDetail {
  id: string;
  label: string;
  dateStart: string;
  dateEnd: string;
  status: string;
  archived: boolean | null;
  waveTransactions: WaveTransaction[];
}

export interface WaveTransaction {
  id: string;
  transactionId: string;
  transactionDate: string;
  amount: string;
  counterpartyName: string | null;
  counterpartyMobile: string | null;
  projectId: string | null;
  allocations: { name: string; amount: number }[] | null;
}

export interface CashAllocation {
  id: string;
  sessionId: string;
  projectId: string;
  personName: string;
  amount: string;
}

export interface Project {
  id: string;
  number?: string;
  name: string;
  isCompleted?: boolean | null;
}

export interface InvoiceRow {
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

export interface ReconciliationLink {
  id: string;
  invoiceId: string;
  waveTransactionId: string | null;
  waveAmount: string;
  cashAmount: string;
  waveDate: string | null;
  waveTotal: string | null;
  waveCounterparty: string | null;
  // Invoice details from join
  invoiceAmount: string | null;
  invoiceDate: string | null;
  invoiceDescription: string | null;
  invoicePaymentType: string | null;
  supplierName: string | null;
}

export interface Summary {
  totalWaveImported: number;
  totalWaveCount: number;
  totalWaveReconciled: number;
  totalCashReconciled: number;
  invoicesReconciled: number;
  orphanWaves: {
    id: string;
    transactionId: string;
    transactionDate: string;
    amount: string;
    counterpartyName: string | null;
    usedAmount: string;
    remaining: number;
  }[];
  orphanWaveCount: number;
  orphanWaveTotal: number;
}

export type WaveFilter = "all" | "linked" | "unlinked";

/**
 * Forme dérivée d'un `ReconciliationLink` utilisée dans le mapping
 * `waveId -> [invoices liées]` par `WorkspacePage.waveToLinks`.
 * Extraite pour que `WaveLinkPanel` et `WaveRow` partagent le même type.
 */
export interface WaveLinkEntry {
  linkId: string;
  invoiceId: string;
  waveAmount: number;
  supplierName: string | null;
  invoiceAmount: string | null;
  invoiceDate: string | null;
  invoiceDescription: string | null;
}
