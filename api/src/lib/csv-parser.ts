/**
 * Parser for Wave Business CSV exports.
 *
 * Expected columns:
 *   Expense Date, Paid Through, Transaction ID, Amount, Counterparty Name, Counterparty Mobile
 *
 * - Separator: comma
 * - Date format: DD/MM/YYYY
 * - Amount: integer, negative = payment (keep), positive = deposit (skip)
 * - Transaction ID: "pt-..." = payment, "LT_..." = deposit
 */

export interface ParsedWaveTransaction {
  transactionId: string;
  transactionDate: string; // YYYY-MM-DD
  amount: number; // positive (absolute value)
  counterpartyName: string | null;
  counterpartyMobile: string | null;
  rawLine: string;
}

export interface ParseResult {
  transactions: ParsedWaveTransaction[];
  warnings: string[];
  totalSkipped: number;
}

function parseDateDDMMYYYY(raw: string): string | null {
  const parts = raw.trim().split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(yyyy, 10);
  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 2000) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  return num;
}

export function parseWaveCsv(csvContent: string): ParseResult {
  const warnings: string[] = [];
  const transactions: ParsedWaveTransaction[] = [];
  let totalSkipped = 0;

  // Handle BOM
  let content = csvContent;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    warnings.push("Le fichier CSV est vide ou ne contient qu'un en-tête.");
    return { transactions, warnings, totalSkipped: 0 };
  }

  // Validate header
  const header = lines[0].toLowerCase();
  if (!header.includes("expense date") || !header.includes("amount")) {
    warnings.push(
      `En-tête non reconnu: "${lines[0]}". Colonnes attendues: Expense Date, Paid Through, Transaction ID, Amount, Counterparty Name, Counterparty Mobile`
    );
    return { transactions, warnings, totalSkipped: 0 };
  }

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    // Simple CSV split (Wave CSV doesn't have quoted fields with commas)
    const cols = rawLine.split(",");

    if (cols.length < 4) {
      warnings.push(`Ligne ${i + 1}: nombre de colonnes insuffisant — ignorée`);
      continue;
    }

    const dateStr = cols[0].trim();
    const transactionId = cols[2]?.trim() || "";
    const amountStr = cols[3].trim();
    const counterpartyName = cols[4]?.trim() || null;
    const counterpartyMobile = cols[5]?.trim() || null;

    const date = parseDateDDMMYYYY(dateStr);
    if (!date) {
      warnings.push(
        `Ligne ${i + 1}: date invalide "${dateStr}" — ignorée`
      );
      continue;
    }

    const amount = parseAmount(amountStr);
    if (amount === null) {
      warnings.push(
        `Ligne ${i + 1}: montant invalide "${amountStr}" — ignorée`
      );
      continue;
    }

    // Skip positive amounts (deposits/appros)
    if (amount >= 0) {
      totalSkipped++;
      continue;
    }

    transactions.push({
      transactionId,
      transactionDate: date,
      amount: Math.abs(amount), // Store as positive
      counterpartyName: counterpartyName || null,
      counterpartyMobile: counterpartyMobile || null,
      rawLine,
    });
  }

  return { transactions, warnings, totalSkipped };
}
