import {
  pgSchema,
  varchar,
  text,
  date,
  decimal,
  timestamp,
  index,
  boolean,
} from "drizzle-orm/pg-core";

export const khalisSchema = pgSchema("khalis");

// --- Sessions de rapprochement ---
export const sessions = khalisSchema.table("sessions", {
  id: varchar("id").primaryKey(),
  label: text("label").notNull(),
  dateStart: date("date_start").notNull(),
  dateEnd: date("date_end").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("en_cours"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Transactions Wave importées depuis CSV ---
export const waveTransactions = khalisSchema.table(
  "wave_transactions",
  {
    id: varchar("id").primaryKey(),
    sessionId: varchar("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    transactionId: varchar("transaction_id").notNull(),
    transactionDate: date("transaction_date").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    counterpartyName: text("counterparty_name"),
    counterpartyMobile: varchar("counterparty_mobile", { length: 20 }),
    rawLine: text("raw_line").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index("wave_txn_session_idx").on(table.sessionId),
    tidIdx: index("wave_txn_tid_idx").on(table.transactionId),
  })
);

// --- Liens de rapprochement ---
export const reconciliationLinks = khalisSchema.table(
  "reconciliation_links",
  {
    id: varchar("id").primaryKey(),
    sessionId: varchar("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    invoiceId: varchar("invoice_id").notNull(),
    waveTransactionId: varchar("wave_transaction_id").references(
      () => waveTransactions.id,
      { onDelete: "set null" }
    ),
    waveAmount: decimal("wave_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    cashAmount: decimal("cash_amount", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index("recon_session_idx").on(table.sessionId),
    invoiceIdx: index("recon_invoice_idx").on(table.invoiceId),
    waveTxnIdx: index("recon_wave_txn_idx").on(table.waveTransactionId),
  })
);
