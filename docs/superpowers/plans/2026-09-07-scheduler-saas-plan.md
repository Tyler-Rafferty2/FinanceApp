# Scheduler SaaS Implementation Plan (Barebones)

**Goal:** Build a multi-tenant staff scheduling SaaS on AWS, phase by phase, as a vehicle for learning API Gateway, serverless compute, and event-driven architecture. The user is writing the code themselves — this plan is a checklist of deliverables and checkpoints, not pre-written implementation.

**Architecture:** Serverless throughout (Lambda + API Gateway REST/WebSocket), RDS Postgres for tenant data, Cognito for auth, SQS/EventBridge for async/event-driven work, DynamoDB for WebSocket connection state, Terraform for IaC. See spec for full detail.

**Tech Stack:** Node.js/TypeScript (Lambda + frontend), Terraform, Postgres, React/Next.js.

**Spec:** `docs/superpowers/specs/2026-09-07-scheduler-saas-design.md`

## Global Constraints

- Multi-tenant: every Postgres table/query scoped by `tenant_id`, sourced from verified JWT claims — never from client input.
- Free tier first; RDS is the one component with a 12-month free-tier clock.
- IaC via Terraform, module layout as defined in the spec (`infra/modules/*`, `infra/envs/dev`).
- One environment (`dev`) for the whole plan; `prod` is out of scope.
- RDS cost control: `terraform apply` at the start of a work session, `terraform destroy` at the end. RDS runs 24/7 once created (unlike Lambda/serverless pieces) and 12-month free tier may not apply to this account — a $10/mo AWS Budget alert (`scheduler-monthly-10`, email) is the backstop if a session ends without destroying. Expect ~7 min for RDS to come up on each `apply`.

---

## Phase 1: Foundations

**Learn:** Terraform basics, AWS account/IAM setup, networking basics, RDS.

- [X] Create/confirm an AWS account and an IAM user (not root) with programmatic access for Terraform.
- [X] Set up Terraform project structure: `infra/modules/{network,database}`, `infra/envs/dev`.
- [X] `network` module: VPC, private subnets, security groups (private-subnets-only — see spec's Networking note; no IGW/NAT needed).
- [X] `database` module: RDS Postgres instance (free-tier eligible instance class), security group allowing access only from Lambda's SG.
- [X] Write the initial Postgres schema (`tenants`, `users` [merged with `employees`], `shifts`, `notifications_log` — see spec's Data Model section) via Drizzle ORM (`backend/src/db/schema.ts`); generate the migration with `npx drizzle-kit generate` (produces a plain, readable `.sql` file under `backend/drizzle/`).
- [X] Apply the schema to RDS. RDS has no path from outside the VPC (private-subnets-only, no NAT/endpoint), so local `psql`/`drizzle-kit migrate` can't reach it — instead, built a one-off/reusable **migration Lambda** (`infra/modules/migrate`, code in `backend/src/lambdas/migrate/handler.ts`), VPC-attached using the existing `lambda` SG + private subnets, that runs Drizzle's migrator against the bundled `.sql` files. Terraform fetches the DB credentials from Secrets Manager at `apply` time and passes them to the Lambda as env vars (the Lambda itself has no internet path to call Secrets Manager at runtime — a sandbox-appropriate tradeoff, revisit for any real production account). Required `ssl: "require"` on the Postgres connection since RDS rejects unencrypted connections by default. Rebuild + redeploy loop for future schema changes: edit `schema.ts` → `npm run db:generate` → `npm run build:migrate` → `terraform apply` → `aws lambda invoke --function-name dev-scheduler-migrate`.

**Done when:** `terraform apply` succeeds and the migration Lambda invoke returns `{"status":"ok"}` — verified 2026-09-07: `tenants`/`users`/`shifts`/`notifications_log` tables and their enums exist in the live dev RDS instance.

---

## Phase 2: Auth

**Learn:** Cognito, JWT, Lambda triggers.

- [ ] `auth` Terraform module: Cognito user pool + app client, with a custom attribute for `tenant_id` (and `role` — either a custom attribute or a Cognito group).
- [ ] Write the `PostConfirmation` Lambda trigger: on signup, insert a `tenants` row (if new company) and a `users` row, then stamp `tenant_id` back onto the Cognito user.
- [ ] Wire the trigger to the user pool in Terraform.
- [ ] Test signup/login manually via AWS CLI or Cognito hosted UI; confirm the `users`/`tenants` rows appear in Postgres and the JWT contains `tenant_id`.

**Done when:** You can sign up a new user, and a decoded JWT from login shows the correct `tenant_id` claim, matching a row in Postgres.

---

## Phase 3: Core API

**Learn:** API Gateway (REST), Lambda, claims-based authorization.

- [ ] `api` Terraform module: API Gateway REST API, Cognito authorizer wired to the Phase 2 user pool.
- [ ] Lambda: `companies` (CRUD for tenant/company settings).
- [ ] Lambda: `employees` (CRUD, scoped by `tenant_id` from JWT claims).
- [ ] Lambda: `shifts` (CRUD, scoped by `tenant_id`; basic overlap/conflict check on create).
- [ ] IAM execution roles per Lambda, least-privilege (only the RDS access each needs).
- [ ] Manual test: call each route with a valid JWT (Postman/curl) and confirm tenant isolation — a user from tenant A cannot see or modify tenant B's data even if they guess an ID.

**Done when:** All CRUD routes work end-to-end through API Gateway with a real JWT, and a cross-tenant access attempt is rejected.

---

## Phase 4: Frontend

**Learn:** Static hosting, CDN, CORS.

- [ ] `frontend` Terraform module: S3 bucket (static hosting) + CloudFront distribution.
- [ ] Minimal React/Next app: login (Cognito), employee list, shift calendar/list view, create/edit shift form.
- [ ] Configure CORS on API Gateway for the CloudFront domain.
- [ ] Build and deploy the frontend to S3, invalidate CloudFront cache.

**Done when:** You can log in through the deployed frontend URL and see/create shifts against the real API.

---

## Phase 5: Event-Driven Layer

**Learn:** Async messaging (SQS), event-driven design, scheduled jobs (EventBridge), SES.

- [ ] `async` Terraform module: SQS queue `shift-events` + DLQ `shift-events-dlq` (redrive policy after N failed attempts).
- [ ] Update `shifts` Lambda: after a successful write, push a message to `shift-events`.
- [ ] Lambda: `notifications` — SQS-triggered consumer, sends an email via SES for a shift-change message.
- [ ] SES: verify a sender identity (sandbox mode is fine for a learning project).
- [ ] EventBridge scheduled rule (e.g. daily) + Lambda: `reminders` — query upcoming shifts, push reminder messages onto `shift-events`.
- [ ] Test failure handling: force an error in `notifications` (e.g. bad email) and confirm the message lands in the DLQ after retries.

**Done when:** Creating/editing a shift triggers a real email, the daily EventBridge rule fires on schedule, and a deliberately-broken message ends up in the DLQ instead of retrying forever.

---

## Phase 6: Real-Time Layer

**Learn:** WebSocket APIs, connection lifecycle, DynamoDB as ephemeral state, `PostToConnection`.

- [ ] `realtime` Terraform module: API Gateway WebSocket API, DynamoDB table `connections` (PK `connectionId`, attributes `tenantId`, `userId`).
- [ ] Lambda: `connections` handler for `$connect` (validate JWT, write row) and `$disconnect` (delete row).
- [ ] Update `shifts` Lambda: after a write, query `connections` for the tenant and call `PostToConnection` for each; on a 410 response, delete that stale row.
- [ ] Frontend: open a WebSocket connection on login, listen for shift-update messages, refresh the relevant view.

**Done when:** With two browser sessions open for the same tenant, a shift change in one updates the other live, without a page refresh.

---

## Phase 7: Observability & Resilience

**Learn:** Monitoring, tracing, failure handling.

- [ ] `observability` Terraform module: CloudWatch alarms on Lambda error rate (all functions) and SQS DLQ depth > 0.
- [ ] Enable X-Ray tracing on API Gateway (both APIs) and all Lambdas.
- [ ] Deliberately induce a failure (e.g. temporarily break SES permissions) and confirm: the alarm fires, the X-Ray trace shows where it failed, the DLQ receives the message.

**Done when:** You can point to a specific X-Ray trace and CloudWatch alarm for a deliberately-induced failure.

---

## Phase 8: CI/CD (stretch)

**Learn:** Automated deployment pipelines.

- [ ] GitHub Actions workflow: `terraform plan` on PR, `terraform apply` on merge to `main`.
- [ ] GitHub Actions workflow: build + deploy Lambda code and frontend on merge.

**Done when:** A push to `main` deploys infra and code changes without a manual `terraform apply` or manual S3 upload.

---

## Future Extensions (not part of this plan)

- Chat feature (reuses Phase 6's `connections` table + a new `messages` table + `sendMessage` route).
- `prod` environment.
