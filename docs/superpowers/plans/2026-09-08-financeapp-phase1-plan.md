# FinanceApp Phase 1 (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scheduler's Phase 1 foundations with FinanceApp's: the renamed Terraform infra applied as a real (recreated) RDS instance, and the new finance schema (`users`, `categories`, `accounts`, `transactions`) migrated onto it via the existing migration-Lambda pattern.

**Architecture:** No new AWS services vs. the scheduler's Phase 1 — same `network`/`database`/`migrate` Terraform modules (already renamed from "scheduler" to "financeapp" in a prior commit, not yet applied), same Drizzle-schema → `drizzle-kit generate` → migration-Lambda-invoke flow. Only the schema content and resource names change.

**Tech Stack:** Terraform (AWS provider ~>5.0), Node.js/TypeScript, Drizzle ORM, `postgres` driver, esbuild (Lambda bundling).

**Spec:** `docs/superpowers/specs/2026-09-08-financeapp-design.md`

## Global Constraints

- Every table carries `user_id` directly (no `tenant_id` / tenants table) — flat per-user ownership, per the spec's Data Model section.
- `user_id` scoping is enforced at the API layer from verified JWT claims in later phases; Phase 1 only needs the column to exist with a `references(() => users.id)` foreign key.
- Balances are computed on read (`SUM(amount)` per account), not cached — no `balance` column on `accounts`.
- `transactions.source` defaults to `"manual"` and includes a `"plaid"` value now so the Plaid phase (Phase 6) doesn't need a migration just to add the enum value.
- RDS stays free-tier eligible: `db.t3.micro` (already the module default, unchanged).
- This plan does not touch `categories`/`accounts`/`transactions` CRUD Lambdas, Cognito, or the frontend — those are later phases (Auth, Core API, Frontend) per the spec's Learning Roadmap, each getting its own plan.

---

### Task 1: Write the FinanceApp schema

**Files:**
- Modify: `backend/src/db/schema.ts` (currently an empty stub comment)

**Interfaces:**
- Produces: `users`, `categories`, `accounts`, `transactions` tables and `categoryKind`, `accountType`, `transactionSource` enums, all exported from `backend/src/db/schema.ts` — later phases (Auth's `PostConfirmation` trigger, Core API Lambdas) import these directly by name.

- [ ] **Step 1: Write the schema**

Replace the contents of `backend/src/db/schema.ts` with:

```typescript
import { pgTable, pgEnum, uuid, text, timestamp, numeric } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  cognitoSub: text("cognito_sub").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const categoryKind = pgEnum("category_kind", ["income", "expense"]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  kind: categoryKind("kind").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountType = pgEnum("account_type", ["checking", "savings", "credit_card", "cash", "investment"]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: accountType("type").notNull(),
  institution: text("institution"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactionSource = pgEnum("transaction_source", ["manual", "plaid"]);

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  categoryId: uuid("category_id").references(() => categories.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(), // negative = expense, positive = income
  description: text("description"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  source: transactionSource("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Type-check it**

Run: `cd backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd backend
git add src/db/schema.ts
git commit -m "$(cat <<'EOF'
Write the FinanceApp Drizzle schema (users, categories, accounts, transactions)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B4rpauC8UHQNnpSWt6oo8j
EOF
)"
```

---

### Task 2: Generate the Drizzle migration

**Files:**
- Create: `backend/drizzle/0000_<auto-generated-name>.sql` (Drizzle names this from a word list — do not rename it)
- Create: `backend/drizzle/meta/0000_snapshot.json`, `backend/drizzle/meta/_journal.json`

**Interfaces:**
- Consumes: `backend/src/db/schema.ts` (Task 1), `backend/drizzle.config.ts` (already configured, points `schema` at `./src/db/schema.ts` and `out` at `./drizzle`)
- Produces: the SQL migration file the `migrate` Lambda (Task 4) applies to RDS.

- [ ] **Step 1: Generate**

Run: `cd backend && npx drizzle-kit generate`
Expected: output naming a new file like `drizzle/0000_<two-word-name>.sql`, and `drizzle/meta/` populated.

- [ ] **Step 2: Inspect the generated SQL**

Open the new `backend/drizzle/0000_*.sql` file and confirm it contains, in some order: `CREATE TYPE "public"."category_kind"`, `CREATE TYPE "public"."account_type"`, `CREATE TYPE "public"."transaction_source"`, and `CREATE TABLE "users"`, `CREATE TABLE "categories"`, `CREATE TABLE "accounts"`, `CREATE TABLE "transactions"` — each with the columns from Task 1's schema, and `transactions` referencing `accounts.id`/`categories.id`/`users.id` via foreign keys.

If any table/enum is missing or a column looks wrong, fix `schema.ts`, delete the generated `drizzle/0000_*.sql` and `drizzle/meta/*` files, and re-run Step 1 — don't hand-edit the generated SQL.

- [ ] **Step 3: Commit**

```bash
cd backend
git add drizzle/
git commit -m "$(cat <<'EOF'
Generate the FinanceApp initial migration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B4rpauC8UHQNnpSWt6oo8j
EOF
)"
```

---

### Task 3: Rebuild the migrate Lambda bundle

**Files:**
- Uses: `backend/scripts/build-migrate.sh` (existing, unmodified), `backend/src/lambdas/migrate/handler.ts` (already renamed to connect to the `financeapp` database in a prior commit)
- Produces (gitignored, not committed): `backend/dist/migrate.zip`

**Interfaces:**
- Consumes: `backend/drizzle/` (Task 2's generated migration is bundled into the zip)
- Produces: `backend/dist/migrate.zip`, which `infra/modules/migrate/main.tf`'s `aws_lambda_function.migrate` resource reads via `filename`/`source_code_hash` in Task 4.

- [ ] **Step 1: Build**

Run: `cd backend && npm run build:migrate`
Expected: `Built dist/migrate.zip` printed, and `backend/dist/migrate.zip` exists.

- [ ] **Step 2: Verify the zip contains the new migration**

Run: `unzip -l backend/dist/migrate.zip | grep drizzle/`
Expected: lists `drizzle/0000_*.sql` (the file from Task 2) and `drizzle/meta/`.

No commit for this task — `dist/` is gitignored, and Terraform (Task 4) reads the zip straight off disk via `source_code_hash`.

---

### Task 4: Apply the renamed infra and migrate the schema

**Files:**
- Uses: `infra/envs/dev/*.tf`, `infra/modules/{network,database,migrate}/*.tf` (already renamed to "financeapp" resource names in a prior commit, not yet applied)

**Interfaces:**
- Consumes: `backend/dist/migrate.zip` (Task 3)
- Produces: a live `dev-financeapp-db` RDS instance and `dev-financeapp-migrate` Lambda; no code artifact other later tasks import, but later phases' Terraform modules (`auth`, `api`) will read `module.network`/`module.database` outputs the same way `module.migrate` already does in `infra/envs/dev/main.tf`.

This task changes real AWS resources: renaming the RDS `identifier`/`username` forces Terraform to **destroy the existing `dev-scheduler-db` instance and create a new `dev-financeapp-db` one** (~7 min). Confirm before running `apply` that there's no data on the current instance worth keeping — there shouldn't be, since it only ever held the now-deleted scheduler schema (empty tables, no scheduler app was ever built to write user data into it).

- [ ] **Step 1: Review the plan**

Run: `cd infra/envs/dev && terraform init && terraform plan`
Expected: plan shows `aws_db_instance.this`, `aws_db_subnet_group.this`, `aws_vpc.this`, `aws_subnet.private` (x2), `aws_security_group.lambda`, `aws_security_group.rds` as replacements (destroy + create, due to renamed identifier/username/tags forcing new resources), and `aws_lambda_function.migrate` / `aws_iam_role.migrate` as replacements (renamed). No resource should show as an in-place update that surprises you — if anything unexpected appears (e.g. a resource you didn't expect to change), stop and investigate before applying.

- [ ] **Step 2: Apply**

Run: `terraform apply`
Type `yes` when prompted after reviewing the plan output matches Step 1.
Expected: apply completes successfully; note the `db_endpoint` and `db_secret_arn` outputs it prints.

- [ ] **Step 3: Invoke the migration Lambda**

Run:
```bash
aws lambda invoke \
  --function-name dev-financeapp-migrate \
  --profile scheduler \
  --cli-binary-format raw-in-base64-out \
  /tmp/migrate-output.json
cat /tmp/migrate-output.json
```
Expected: `{"status": "ok"}`. (`--profile scheduler` matches the current `aws_profile` Terraform variable default — that variable name was deliberately left as-is since it refers to your local AWS CLI profile, not an app resource.)

If the invoke instead returns an error or times out, check `aws logs tail /aws/lambda/dev-financeapp-migrate --profile scheduler --since 5m` for the Lambda's console output before retrying.

- [ ] **Step 4: Verify the tables exist**

Using the AWS Console's RDS Query Editor (or any client reachable from inside the VPC — there is intentionally no path from your local machine, per the network module's private-subnets-only design), connect to `dev-financeapp-db` using the credentials in the `db_secret_arn` output from Step 2, and run:

```sql
select table_name from information_schema.tables where table_schema = 'public' order by 1;
```

Expected: `users`, `categories`, `accounts`, `transactions` (and no `tenants`, `shifts`, or `notifications_log`).

- [ ] **Step 5: Commit the plan checkbox update**

Update this file's checkboxes (all four tasks) to checked, then:

```bash
git add docs/superpowers/plans/2026-09-08-financeapp-phase1-plan.md
git commit -m "$(cat <<'EOF'
Mark FinanceApp Phase 1 complete: renamed infra applied, finance schema migrated

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01B4rpauC8UHQNnpSWt6oo8j
EOF
)"
```

---

## Done When

`terraform apply` succeeds against the renamed infra, `aws lambda invoke --function-name dev-financeapp-migrate` returns `{"status":"ok"}`, and the live `dev-financeapp-db` instance has exactly the `users`/`categories`/`accounts`/`transactions` tables (plus their enums) — no leftover scheduler tables.

## Next Phase

Phase 2 (Auth: Cognito user pool + `PostConfirmation` trigger) gets its own plan once this one is done and verified — see the Learning Roadmap in `docs/superpowers/specs/2026-09-08-financeapp-design.md`.
