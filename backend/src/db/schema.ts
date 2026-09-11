// FinanceApp schema — see docs/superpowers/specs/2026-09-08-financeapp-design.md for the data model
// (users, categories, accounts, transactions). Tables land here as part of the implementation plan.
import { pgTable, pgEnum, uuid, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    cognitoSub: text("cognito_sub").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categoryKind = pgEnum("category_kind", ["income", "expense"]);

export const categories = pgTable("categories", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: categoryKind("kind").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountType = pgEnum("account_type", ["checking", "savings", "credit_card", "cash", "investment"]);

export const accounts = pgTable("accounts", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    type: accountType("type").notNull(),
    institution: text("institution"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const source = pgEnum("transaction_source", ["manual", "plaid"]);

export const transactions = pgTable("transactions", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id),
    categoryId: uuid("category_id").references(() => categories.id),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: source("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});


