# Scheduler SaaS — Design Spec

Date: 2026-09-07

## Purpose

A multi-tenant staff/shift scheduling web application for companies (think: a company manages employees, roles, and shift assignments). The primary goal of this project is **learning system design and AWS** — specifically API Gateway, serverless compute, and event-driven architecture — through building a realistic SaaS product. Architecture decisions favor breadth of AWS service exposure and approachable data modeling over minimizing build time or achieving production polish.

## Context / Constraints

- Builder has some prior AWS exposure (used individual services, not designed a multi-service system).
- Priority: broad exposure to many AWS services at a basic-to-intermediate level, over deep specialization in a few.
- Budget: free tier only where possible; a few dollars/month acceptable once free tier windows expire (e.g. RDS after 12 months).
- Pace: ongoing side project, no fixed deadline — the design is phased so it can be picked up incrementally.
- Backend: Node.js/TypeScript. Database access/migrations via Drizzle ORM (chosen over Prisma for Lambda cold-start weight; migrations still generate plain readable SQL).
- IaC: Terraform.
- Multi-tenant SaaS: one shared deployment serves many companies with isolated data.

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
Lambda functions (Node/TS, one per domain area: auth, companies, employees, shifts, notifications, reminders)
   │
   ▼
RDS Postgres (single instance, multi-tenant via tenant_id column)
   │
   ├──► SQS (async jobs: shift-change notifications, reminders)
   │        │
   │        ▼
   │     Lambda consumer ──► SES (email)
   │
   └──► EventBridge (scheduled rule) ──► Lambda (daily reminder digest)

API Gateway (WebSocket) ──► connections Lambda ──► DynamoDB (connections table)
   shifts Lambda pushes live updates via PostToConnection to relevant connections

CloudWatch (logs/metrics/alarms) + X-Ray (tracing) across all Lambdas
Terraform manages all of the above as IaC
```

**Why this shape:** everything is serverless/managed so nothing runs (and costs money) when idle — good for free-tier and for a project worked on intermittently. Each AWS service maps to one clear concern, so components can be learned/built/tested mostly independently. This design intentionally touches ~10 AWS services (API Gateway REST + WebSocket, Lambda, RDS, Cognito, S3, CloudFront, SQS, SES, EventBridge, DynamoDB, CloudWatch, X-Ray) to maximize breadth of exposure.

## Components

| Component | Responsibility | Depends on |
|---|---|---|
| `frontend` | React/Next static app, calls the REST API and opens the WebSocket connection | API Gateway URLs |
| `auth` (Cognito) | User pools per environment; each user carries `tenant_id` + `role` as custom claims | — |
| `api` (API Gateway REST) | Routes HTTP requests to Lambdas, validates JWT via Cognito authorizer | Cognito, Lambdas |
| `companies` Lambda | CRUD for company/tenant records, onboarding | RDS |
| `employees` Lambda | CRUD for the scheduling-relevant fields on `users` within a tenant (job title, etc.) | RDS |
| `shifts` Lambda | Create/update/query shifts, conflict checks, enqueues SQS event, pushes WebSocket update | RDS, SQS, `connections` table |
| `notifications` Lambda (SQS consumer) | Sends emails via SES when a shift is created/changed | SQS, SES |
| `reminders` Lambda (EventBridge trigger) | Daily job: finds upcoming shifts, enqueues reminder notifications | RDS, SQS |
| `db` (RDS Postgres) | Single instance, all tenant data, isolated by `tenant_id` column | — |
| `realtime` (API Gateway WebSocket) | Persistent connections for live schedule updates | Cognito (auth on `$connect`) |
| `connections` Lambda | Handles `$connect`/`$disconnect`, writes/deletes rows in `connections` table | DynamoDB |
| `connections` table (DynamoDB) | Maps `connectionId` ↔ `tenantId`/`userId` for active sessions | — |
| `infra` (Terraform) | Provisions everything above | — |

Each Lambda is a separate deployable unit with a narrow job — components can be built, tested, and deployed independently.

## Data Model & Multi-Tenancy

**Tables (Postgres, via Drizzle ORM — schema in `backend/src/db/schema.ts`):**
- `tenants` — id, name, plan, created_at
- `users` — id, tenant_id, cognito_sub, email, name, role (admin/manager/employee — permission level), job_title (descriptive only, e.g. "Cashier"), created_at. Merged with the earlier separate `employees` concept: every scheduled person also has a login/Cognito account — a sandbox-project simplification.
- `shifts` — id, tenant_id, employee_id (references `users.id`), start_time, end_time, location, description (what they're doing this shift, e.g. "Cashier — gift shop"; distinct from `users.job_title`), status (enum: scheduled/completed/cancelled), created_at
- `notifications_log` — id, tenant_id, shift_id, type (enum: shift_created/shift_updated/shift_reminder), status (enum: sent/failed), sent_at

**DynamoDB table:**
- `connections` — connectionId (PK), tenantId, userId

**Isolation strategy:** every Postgres table carries `tenant_id`; every query filters on it. The Lambda pulls `tenant_id` out of the verified JWT claims (never from client-supplied input) and injects it into every query — the standard "pooled" multi-tenancy pattern. A bug here would leak one company's data to another, so this is the primary security-critical path in the system.

## Auth Flow

1. User signs up/logs in via Cognito (hosted UI or SDK).
2. On signup, a `PostConfirmation` Lambda trigger creates the `tenants`/`users` row and stamps `tenant_id` as a custom Cognito attribute.
3. Client calls the REST API with the Cognito JWT in the `Authorization` header.
4. API Gateway's Cognito authorizer validates the JWT and passes claims (including `tenant_id`, `role`) to the Lambda via the request context.
5. Lambda uses those claims for both data scoping and role-based authorization (e.g. only `admin`/`manager` can create shifts).
6. The WebSocket `$connect` route performs the same JWT validation before accepting the connection.

## Async / Event-Driven Flow

- `shifts` Lambda, after writing a shift change, pushes a message to an SQS queue (`shift-events`).
- `notifications` Lambda consumes that queue, sends an email via SES.
- Failed messages retry per SQS redrive policy, then land in a dead-letter queue (`shift-events-dlq`) after N failures.
- EventBridge has one scheduled rule (e.g. daily at 6am) that triggers `reminders` Lambda, which queries upcoming shifts and pushes reminder messages onto the same `shift-events` queue, reusing the notification pipeline.

**Networking note:** `shifts` and `reminders` are VPC-attached (they need RDS), and both also need to reach SQS's public API. Rather than a NAT Gateway (~$32/mo baseline), this uses a single-AZ SQS **VPC interface endpoint** (~$7-8/mo) so those Lambdas reach SQS over AWS's private network instead of the internet. `notifications` (SQS-triggered, calls SES) does not touch RDS and is therefore **not** VPC-attached — it gets normal outbound internet access for free, no endpoint needed.

## Real-Time Layer (WebSocket)

- API Gateway WebSocket API terminates persistent client connections; Lambda never holds a connection open, it only reacts to `$connect`, `$disconnect`, and message events.
- `$connect`: validates the Cognito JWT, writes `{connectionId, tenantId, userId}` to the `connections` DynamoDB table.
- `$disconnect`: deletes the corresponding row.
- When `shifts` Lambda writes a shift change, it queries `connections` for all rows matching the tenant and calls the API Gateway Management API's `PostToConnection` for each, pushing the update live to open browser tabs for that tenant.
- A `PostToConnection` call returning 410 (Gone) indicates a stale connection; the row is deleted from `connections`.

**Explicitly out of scope for now:** a chat feature. It would reuse this same `connections` table plus a new `messages` RDS table and a `sendMessage` WebSocket route, but is not part of the initial build.

## Observability

- Every Lambda emits structured JSON logs to CloudWatch Logs.
- X-Ray tracing enabled on both API Gateways + all Lambdas, to see full request traces (API Gateway → Lambda → RDS/SQS) and spot latency bottlenecks.
- CloudWatch Alarms on Lambda error rate and SQS DLQ depth > 0.

## Infrastructure as Code (Terraform)

```
infra/
  modules/
    network/       (VPC, subnets — needed for RDS)
    database/      (RDS instance, security groups)
    auth/          (Cognito user pool, app client)
    api/           (API Gateway REST, Lambda functions, IAM roles)
    async/         (SQS queues, EventBridge rule)
    realtime/       (API Gateway WebSocket, connections Lambda, DynamoDB table)
    frontend/      (S3, CloudFront)
    observability/ (CloudWatch alarms, dashboards)
  envs/
    dev/           (ties modules together, dev-sized resources)
```

One environment (`dev`) to start. A `prod` environment can be added later once the pattern is familiar — itself a lesson in environment promotion.

## Testing & Error Handling

- **Unit tests**: Lambda handlers tested with mocked AWS SDK clients, isolating business logic from AWS calls.
- **Integration tests**: run against a local Postgres (Docker) for the data layer; LocalStack can be added later for AWS service mocking.
- **Error handling**: Lambdas return structured error responses (4xx for validation/authz, 5xx for unexpected); SQS DLQ catches poison messages; API Gateway maps Lambda errors to proper HTTP status codes.

## Learning Roadmap (Phases)

Sequenced so each phase teaches a coherent chunk of AWS/system-design concepts before the next is added. Each phase ends with something working, suited to an intermittent side-project pace.

1. **Foundations** — Terraform basics, AWS account/IAM setup, VPC + RDS Postgres provisioned, schema migrated. *Learn: IaC fundamentals, networking basics, RDS.*
2. **Auth** — Cognito user pool, signup/login, `PostConfirmation` trigger creating tenant/user rows. *Learn: Cognito, JWT, Lambda triggers.*
3. **Core API** — API Gateway (REST) + Lambdas for companies/employees/shifts CRUD, Cognito authorizer wired in, tenant isolation enforced. *Learn: API Gateway, Lambda, claims-based authz.*
4. **Frontend** — React/Next app on S3+CloudFront calling the API. *Learn: static hosting, CDN, CORS.*
5. **Event-driven layer** — SQS queue + `notifications` Lambda + SES, DLQ, EventBridge scheduled reminders. *Learn: async messaging, event-driven design, scheduled jobs.*
6. **Real-time layer** — WebSocket API Gateway, `$connect`/`$disconnect` Lambda, DynamoDB connections table, push live shift updates from the `shifts` Lambda. *Learn: WebSocket APIs, connection lifecycle, DynamoDB as ephemeral state store, PostToConnection.*
7. **Observability & resilience** — CloudWatch dashboards/alarms, X-Ray tracing, deliberately induce a failure (e.g. throttle SES) and observe it. *Learn: monitoring, tracing, failure handling.*
8. **CI/CD (stretch)** — GitHub Actions to run Terraform plan/apply and deploy Lambdas on push. *Learn: automated deployment pipelines.*

## Future Extensions (noted, not built)

- **Chat feature**: reuses the `connections` table and WebSocket infrastructure from Phase 6, plus a new `messages` RDS table and `sendMessage` route.
- **`prod` environment**: promote the Terraform `dev` pattern to a second environment.
