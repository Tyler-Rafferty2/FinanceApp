# FinanceApp — Design Spec

Date: 2026-09-08

## Purpose

A multi-user personal finance tracker (think: a simplified Mint/YNAB) — each user tracks their own accounts, transactions, and categories. This project replaces the earlier "Scheduler SaaS" learning project in this repo; the underlying goal is unchanged: **learning system design and AWS** — specifically API Gateway, serverless compute, and event-driven architecture — through building a realistic product. Architecture decisions favor breadth of AWS service exposure and approachable data modeling over minimizing build time or achieving production polish.

This spec supersedes `docs/superpowers/specs/2026-09-07-scheduler-saas-design.md` and `docs/superpowers/plans/2026-09-07-scheduler-saas-plan.md`, which are removed as part of this pivot.

## Context / Constraints

- Builder has some prior AWS exposure (used individual services, not designed a multi-service system).
- Priority: broad exposure to many AWS services at a basic-to-intermediate level, over deep specialization in a few.
- Budget: free tier only where possible; a few dollars/month acceptable once free tier windows expire (e.g. RDS after 12 months).
- Pace: ongoing side project, no fixed deadline — the design is phased so it can be picked up incrementally.
- Backend: Node.js/TypeScript. Database access/migrations via Drizzle ORM (chosen over Prisma for Lambda cold-start weight; migrations still generate plain readable SQL).
- IaC: Terraform. The `network` and `database` modules already exist and are applied in this repo (originally built for the scheduler project) and are reused here, with resource names renamed from "scheduler" to "financeapp" (see Infrastructure Rename below).
- Multi-user product: each user's data (accounts, transactions, categories) is private to them. No cross-user sharing or "tenant/company" concept — flat per-user ownership via a `user_id` column, simpler than the scheduler's tenant model.
- Transaction entry: **manual entry first**; Plaid **Sandbox** (free, fake institutions/test credentials, no real bank linking) integration comes later as its own phase. No paid/production Plaid usage.
- Budgets, recurring-bill detection, and real (production) bank linking are explicitly out of scope for this spec — noted as future extensions.

## Architecture Overview

```
Browser (React/Next.js)
   │
   ▼
CloudFront (CDN) ──► S3 (static frontend)
   │
   ▼
API Gateway (REST) ──► Cognito Authorizer (JWT)
   │
   ▼
Lambda functions (Node/TS, one per domain area: accounts, categories, transactions, plaid-sync)
   │
   ▼
RDS Postgres (single instance, per-user via user_id column)
   │
   ├──► SQS (async jobs: weekly digest email, Plaid transaction sync)
   │        │
   │        ▼
   │     Lambda consumer ──► SES (email) / RDS (store synced transactions)
   │
   └──► EventBridge (scheduled rule) ──► Lambda (weekly digest, scheduled Plaid sync)

API Gateway (REST) ──► Plaid webhook Lambda ──► SQS (new-transactions-ready jobs)

CloudWatch (logs/metrics/alarms) + X-Ray (tracing) across all Lambdas
Terraform manages all of the above as IaC
```

**Why this shape:** everything is serverless/managed so nothing runs (and costs money) when idle — good for free-tier and for a project worked on intermittently. Each AWS service maps to one clear concern, so components can be learned/built/tested mostly independently. Compared to the scheduler design, this drops the WebSocket API Gateway + DynamoDB `connections` table + realtime push layer: pushing live updates to open browser tabs isn't a need this domain has, and cutting it removes real complexity without losing a requested feature. Plaid's webhook delivery is itself just a regular HTTP POST to an API Gateway route — no persistent connection required — so the event-driven pattern from the scheduler design (SQS + EventBridge + Lambda consumers) carries over directly for both the weekly digest and Plaid sync.

## Components

| Component | Responsibility | Depends on |
|---|---|---|
| `frontend` | React/Next static app, calls the REST API | API Gateway URL |
| `auth` (Cognito) | User pool per environment; `PostConfirmation` trigger creates the user's row + seeds default categories | — |
| `api` (API Gateway REST) | Routes HTTP requests to Lambdas, validates JWT via Cognito authorizer | Cognito, Lambdas |
| `accounts` Lambda | CRUD for a user's accounts (checking/savings/credit card/cash/investment) | RDS |
| `categories` Lambda | CRUD for a user's income/expense categories | RDS |
| `transactions` Lambda | CRUD for transactions, scoped to the user; enqueues SQS event for the digest pipeline | RDS, SQS |
| `digest` Lambda (EventBridge trigger) | Weekly job: summarizes each user's spending, enqueues a digest email job | RDS, SQS |
| `notifications` Lambda (SQS consumer) | Sends emails via SES (weekly digest today; extensible to other alerts) | SQS, SES |
| `plaid-webhook` Lambda | Receives Plaid Sandbox webhook calls, enqueues a sync job | SQS |
| `plaid-sync` Lambda (SQS consumer) | Calls Plaid's `/transactions/sync`, writes new transactions | SQS, RDS, Plaid API |
| `db` (RDS Postgres) | Single instance, all user data, isolated by `user_id` column | — |
| `infra` (Terraform) | Provisions everything above | — |

Each Lambda is a separate deployable unit with a narrow job — components can be built, tested, and deployed independently.

## Data Model

**Tables (Postgres, via Drizzle ORM — schema in `backend/src/db/schema.ts`):**

- `users` — id, cognito_sub, email, name, created_at
- `categories` — id, user_id, name, kind (enum: income/expense), created_at. Seeded with a default set (e.g. Groceries, Rent, Salary, Utilities...) by the `PostConfirmation` trigger on signup.
- `accounts` — id, user_id, name, type (enum: checking/savings/credit_card/cash/investment), institution (nullable text), created_at
- `transactions` — id, user_id, account_id (references `accounts.id`), category_id (nullable, references `categories.id`), amount (numeric, signed: negative = expense, positive = income), description, occurred_at, source (enum: manual/plaid, default manual), created_at

**Later (Plaid phase) adds:**
- `plaid_items` — id, user_id, plaid_item_id, plaid_access_token (encrypted at rest via Secrets Manager or pgcrypto — decided during that phase), institution_name, created_at
- `transactions.plaid_transaction_id` (nullable) — dedupe key for synced transactions

**No `tenants` table** — this is the main structural difference from the scheduler schema. Every table carries `user_id` directly instead of a `tenant_id` + separate `users` row per company. Balances are computed on read (`SUM(amount)` per account) rather than cached, keeping writes simple; a cached/materialized balance can be added later if query performance becomes a real issue.

**Isolation strategy:** every query filters on `user_id`, sourced from the verified JWT claim (`sub`/Cognito user id), never from client-supplied input — same pattern as the scheduler's tenant isolation, just one level shallower.

## Auth Flow

1. User signs up/logs in via Cognito (hosted UI or SDK).
2. On signup, a `PostConfirmation` Lambda trigger creates the `users` row and seeds default `categories` rows for that user.
3. Client calls the REST API with the Cognito JWT in the `Authorization` header.
4. API Gateway's Cognito authorizer validates the JWT and passes claims (`sub`) to the Lambda via the request context.
5. Lambda uses the claim to scope every query to that user's own rows.

## Async / Event-Driven Flow

- **Weekly digest:** EventBridge scheduled rule (e.g. Sunday evenings) triggers `digest` Lambda, which computes each user's weekly spend-by-category and enqueues one message per user onto an SQS queue (`notification-events`). `notifications` Lambda consumes the queue and sends the summary via SES.
- **Plaid sync:** Plaid Sandbox calls the `plaid-webhook` API Gateway route when new transactions are ready for a linked (sandbox) item. The webhook Lambda validates the payload and enqueues a sync job onto an SQS queue (`plaid-sync-events`). `plaid-sync` Lambda consumes it, calls Plaid's `/transactions/sync`, and writes new `transactions` rows (deduped by `plaid_transaction_id`).
- Failed messages retry per SQS redrive policy, then land in a dead-letter queue (`notification-events-dlq` / `plaid-sync-events-dlq`) after N failures.

**Networking note:** `transactions`, `digest`, and `plaid-sync` are VPC-attached (they need RDS) and also need to reach SQS's public API. As in the scheduler design, this uses a single-AZ SQS **VPC interface endpoint** (~$7-8/mo) instead of a NAT Gateway (~$32/mo). `notifications` (SQS-triggered, calls SES) and `plaid-webhook` (calls out to nothing but writes to SQS) do not touch RDS and are therefore not VPC-attached.

## Observability

- Every Lambda emits structured JSON logs to CloudWatch Logs.
- X-Ray tracing enabled on the API Gateway + all Lambdas.
- CloudWatch Alarms on Lambda error rate and each SQS DLQ depth > 0.

## Infrastructure Rename

The existing `network` and `database` Terraform modules (built for the scheduler project) are reused as-is structurally, but resource names change from "scheduler" to "financeapp":

- `infra/envs/dev/variables.tf`: `project_name` default `"scheduler"` → `"financeapp"`.
- RDS `identifier` (`dev-scheduler-db` → `dev-financeapp-db`) and `username` (`scheduler_admin` → `financeapp_admin`).
- VPC/subnet/security-group `Name` tags and the Lambda SG `name_prefix`.
- Migrate Lambda `function_name` (`dev-scheduler-migrate` → `dev-financeapp-migrate`) and its IAM role name.

Renaming the RDS `identifier`/`username` forces Terraform to destroy and recreate the RDS instance (~7 min) — acceptable since the schema is being replaced anyway. `backend/package.json`'s `name` field also changes from `scheduler-backend` to `financeapp-backend`.

## Infrastructure as Code (Terraform)

```
infra/
  modules/
    network/       (VPC, subnets — reused, renamed)
    database/      (RDS instance, security groups — reused, renamed)
    migrate/       (migration Lambda — reused, renamed)
    auth/          (Cognito user pool, app client)
    api/           (API Gateway REST, Lambda functions, IAM roles)
    async/         (SQS queues, EventBridge rule)
    plaid/         (Plaid webhook route + sync Lambda, added in the Plaid phase)
    frontend/      (S3, CloudFront)
    observability/ (CloudWatch alarms, dashboards)
  envs/
    dev/           (ties modules together, dev-sized resources)
```

One environment (`dev`) to start, same as before.

## Testing & Error Handling

- **Unit tests**: Lambda handlers tested with mocked AWS SDK/Plaid clients, isolating business logic.
- **Integration tests**: run against a local Postgres (Docker) for the data layer.
- **Error handling**: Lambdas return structured error responses (4xx for validation/authz, 5xx for unexpected); SQS DLQs catch poison messages; API Gateway maps Lambda errors to proper HTTP status codes.

## Learning Roadmap (Phases)

1. **Foundations** — reuse/rename the existing Terraform network+database infra; write and apply the finance schema (`users`, `categories`, `accounts`, `transactions`) via the existing migration-Lambda pattern, replacing the scheduler schema. *Learn: IaC fundamentals (already covered), schema migration on a renamed/recreated instance.*
2. **Auth** — Cognito user pool, signup/login, `PostConfirmation` trigger creating the user row + seeding default categories. *Learn: Cognito, JWT, Lambda triggers.*
3. **Core API** — API Gateway (REST) + Lambdas for accounts/categories/transactions CRUD, Cognito authorizer wired in, per-user isolation enforced. *Learn: API Gateway, Lambda, claims-based authz.*
4. **Frontend** — React/Next app on S3+CloudFront: login, account list, transaction list/add/edit, category management, computed balances. *Learn: static hosting, CDN, CORS.*
5. **Event-driven layer** — SQS queue + `notifications` Lambda + SES, DLQ, EventBridge weekly digest. *Learn: async messaging, event-driven design, scheduled jobs.*
6. **Plaid Sandbox integration** — Plaid Link (sandbox mode) in the frontend, `plaid_items` table, webhook Lambda + `plaid-sync` consumer Lambda pulling transactions into the same table as manual entries. *Learn: third-party webhook integration, idempotent sync, secrets handling.*
7. **Observability & resilience** — CloudWatch dashboards/alarms, X-Ray tracing, deliberately induce a failure (e.g. throttle SES) and observe it. *Learn: monitoring, tracing, failure handling.*
8. **CI/CD (stretch)** — GitHub Actions to run Terraform plan/apply and deploy Lambdas on push. *Learn: automated deployment pipelines.*

## Future Extensions (noted, not built)

- **Budgets**: monthly per-category targets and spend-vs-budget tracking.
- **Recurring-bill detection**: identify recurring transactions, remind before they hit.
- **Real (production) Plaid**: linking actual bank accounts instead of Sandbox test data.
- **Cross-device realtime sync**: push live balance/transaction updates to open browser tabs (the WebSocket/DynamoDB pattern from the original scheduler design, applied here if ever needed).
