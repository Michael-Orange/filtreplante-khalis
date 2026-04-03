/**
 * Cross-schema reference to facture tables (READ-ONLY).
 * Only the columns needed for rapprochement are declared here.
 */
import {
  pgSchema,
  text,
  varchar,
  timestamp,
  decimal,
  boolean,
  serial,
  integer,
} from "drizzle-orm/pg-core";

const factureSchema = pgSchema("facture");

export const suppliers = factureSchema.table("suppliers", {
  id: varchar("id").primaryKey(),
  name: text("name").notNull(),
});

export const invoices = factureSchema.table("invoices", {
  id: varchar("id").primaryKey(),
  userName: text("user_name").notNull(),
  invoiceDate: timestamp("invoice_date").notNull(),
  supplierId: varchar("supplier_id").notNull(),
  category: text("category").notNull(),
  amountDisplayTTC: decimal("amount_display_ttc", {
    precision: 12,
    scale: 2,
  }).notNull(),
  vatApplicable: boolean("vat_applicable"),
  description: text("description").notNull(),
  paymentType: text("payment_type").notNull(),
  archive: varchar("archive"),
  invoiceType: varchar("invoice_type", { length: 50 }),
  invoiceNumber: varchar("invoice_number", { length: 100 }),
  categoryId: integer("category_id"),
  hasBrs: boolean("has_brs"),
  amountRealTTC: decimal("amount_real_ttc", { precision: 12, scale: 2 }),
  paymentStatus: varchar("payment_status", { length: 20 }),
  createdAt: timestamp("created_at").notNull(),
});

export const payments = factureSchema.table("payments", {
  id: serial("id").primaryKey(),
  invoiceId: varchar("invoice_id").notNull(),
  amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).notNull(),
  paymentDate: varchar("payment_date", { length: 10 }).notNull(),
  paymentType: varchar("payment_type", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").notNull(),
});

export const categories = factureSchema.table("categories", {
  id: serial("id").primaryKey(),
  appName: varchar("app_name", { length: 255 }).notNull(),
  accountCode: varchar("account_code", { length: 50 }).notNull(),
});
