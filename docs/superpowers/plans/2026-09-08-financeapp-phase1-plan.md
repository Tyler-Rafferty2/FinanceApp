# FinanceApp Phase 1 (Foundations) — Checklist

**Goal:** Replace the scheduler's Phase 1 foundations with FinanceApp's: the renamed Terraform infra applied as a real (recreated) RDS instance, and a new finance schema migrated onto it via the existing migration-Lambda pattern.

**Spec:** `docs/superpowers/specs/2026-09-08-financeapp-design.md` — see "Data Model" and "Infrastructure Rename" sections.

This is a checklist of what to figure out and build yourself, not a set of answers to paste in. Ask if you get stuck on a specific step, or want something reviewed once you've written it.

## Global Constraints

- Every table carries `user_id` directly (no `tenant_id`/`tenants` table) — flat per-user ownership.
- Balances are computed on read, not cached — don't add a `balance` column.
- RDS stays free-tier eligible (`db.t3.micro`, already the module default).
- This phase is schema + infra only — no CRUD Lambdas, Cognito, or frontend yet.

---

## Task 1: Write the schema

**File:** `backend/src/db/schema.ts` (currently an empty stub comment).

Figure out:
- What tables you need per the spec's Data Model section: `users`, `categories`, `accounts`, `transactions`.
- What columns each needs and their types — think about what a category, an account, and a transaction actually need to store, and which columns should be foreign keys to which tables.
- What enums make sense (e.g. category kind, account type, transaction source) — the spec lists the values.
- How money should be represented (a floating-point type will bite you eventually — think about what Postgres/Drizzle type is meant for exact decimal amounts).
- Whether any columns should be nullable (e.g. does every transaction need a category?).

Reference: the old scheduler schema (deleted, but visible via `git show 57892c2^:backend/src/db/schema.ts`) shows the Drizzle syntax patterns (`pgTable`, `pgEnum`, `uuid().primaryKey().defaultRandom()`, `.references(() => otherTable.id)`, `timestamp(..., { withTimezone: true })`) — don't copy its tables/columns, just the syntax shape.

**Verify:** `cd backend && npx tsc --noEmit` passes with no errors.

---

## Task 2: Generate the migration

Figure out:
- Which npm script (check `backend/package.json`) turns your schema into SQL, and where it writes the output (check `backend/drizzle.config.ts`'s `out` setting).
- Run it.

**Verify:** open the generated `.sql` file. Confirm it has a `CREATE TYPE` for each enum you defined and a `CREATE TABLE` for each of your four tables, with the foreign keys you expect. If something's missing or wrong, fix `schema.ts`, delete the generated migration + `meta/` files, and regenerate — don't hand-edit the generated SQL.

---

## Task 3: Rebuild the migrate Lambda bundle

Figure out:
- There's already a build script for this (`backend/scripts/build-migrate.sh`, wired up as an npm script) — find and run it.
- What it produces and where.

**Verify:** unzip -l (or similar) on the output and confirm your new migration file from Task 2 is inside it, under a `drizzle/` folder.

---

## Task 4: Apply the renamed infra and migrate the schema

This changes real AWS resources. The `infra/modules/{network,database,migrate}` Terraform was already renamed from "scheduler" to "financeapp" in a prior commit but not yet applied — renaming the RDS `identifier`/`username` forces Terraform to destroy the current `dev-scheduler-db` and create `dev-financeapp-db` (~7 min). That's fine — it only ever held the deleted scheduler schema, no real data.

Figure out:
- Run a `terraform plan` in `infra/envs/dev` first. Read through what it says it will do — you should see the RDS instance, subnet group, VPC, subnets, and security groups showing as replacements (destroy + create), plus the migrate Lambda/IAM role. If anything looks like it's touching something you don't expect, stop and figure out why before applying.
- Apply it.
- Invoke the migration Lambda (`aws lambda invoke`) — you'll need the function name (check the Terraform output or the `infra/modules/migrate` code) and your AWS CLI profile name.
- If it fails, `aws logs tail` on the Lambda's log group will show you what happened.

**Verify:**
- The invoke returns `{"status": "ok"}`.
- Confirm the tables actually landed: there's no direct network path from your machine to RDS (private-subnets-only, no NAT/VPC endpoint), so use the AWS Console's RDS Query Editor (credentials from the DB secret ARN Terraform outputs) and query `information_schema.tables` — you should see exactly `users`, `categories`, `accounts`, `transactions` and nothing left over from the scheduler schema.

---

## Done When

`terraform apply` succeeds against the renamed infra, the migrate Lambda invoke returns `{"status":"ok"}`, and the live `dev-financeapp-db` instance has exactly your four tables and their enums.

## Next Phase

Phase 2 (Auth: Cognito user pool + `PostConfirmation` trigger) — figure that out as its own pass once this one's done, using the spec's Learning Roadmap section as a starting point.
