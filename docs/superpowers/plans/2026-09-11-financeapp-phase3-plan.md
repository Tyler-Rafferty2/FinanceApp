# FinanceApp Phase 3 (Core API) — Checklist

**Goal:** A REST API (accounts/categories/transactions CRUD) behind a Cognito-authorized API Gateway, with every request scoped to the calling user.

**Spec:** `docs/superpowers/specs/2026-09-08-financeapp-design.md` — see "Components" (the `api`/`accounts`/`categories`/`transactions` rows) and "Auth Flow" steps 3-5.

This is a checklist of what to figure out and build yourself, not a set of answers to paste in. Ask if you get stuck on a specific step, or want something reviewed once you've written it.

## Global Constraints

- Stay free-tier eligible — no NAT Gateway, no new always-on paid resources.
- No SQS, no digest/notifications, no frontend in this phase — transactions CRUD works standalone, without the enqueue-to-SQS step the spec eventually calls for (that's Phase 5).
- Every query in every Lambda must be scoped to the requesting user's own rows, derived from their verified JWT — never from a client-supplied user id in the path or body.

---

## Task 1: API Gateway + Cognito authorizer (Terraform)

**Files:** new module `infra/modules/api/`, wired into `infra/envs/dev/main.tf`.

Figure out:
- The Terraform resources for a REST API Gateway (`aws_api_gateway_rest_api`) and a Cognito authorizer (`aws_api_gateway_authorizer`, `type = "COGNITO_USER_POOLS"`) pointed at Phase 2's user pool (you'll need to pass the pool's ARN into this module — check what `module.auth`'s outputs currently expose, and add one if it's missing).
- Three top-level resources (`/accounts`, `/categories`, `/transactions`), each with a `{proxy+}` child resource, and an `ANY` method on each `{proxy+}` resource wired via Lambda proxy integration (`aws_api_gateway_integration`, `type = "AWS_PROXY"`) to one Lambda apiece.
- Attaching the Cognito authorizer to each of those three `ANY` methods (`authorization = "COGNITO_USER_POOLS"`, `authorizer_id = ...`).
- What a Terraform `aws_api_gateway_deployment` + `aws_api_gateway_stage` need to look like to actually make the API callable at a URL — API Gateway REST APIs don't serve traffic until deployed to a stage.
- The `aws_lambda_permission` each of the three Lambdas needs, allowing API Gateway to invoke them (same idea as Cognito's permission to invoke the post-confirmation Lambda in Phase 2, different principal: `apigateway.amazonaws.com`).

**Verify:** `terraform plan` in `infra/envs/dev` shows the new API Gateway resources — don't apply yet, since the three Lambdas it references (Task 2) don't exist yet.

---

## Task 2: The three domain Lambdas

**Files:**
- `backend/src/lambdas/accounts/handler.ts`
- `backend/src/lambdas/categories/handler.ts`
- `backend/src/lambdas/transactions/handler.ts`

Figure out, once, then repeat the shape for each of the three:

- **Connecting to the DB**: same postgres/drizzle pattern as `migrate`/`post-confirmation`.
- **Resolving the caller**: with a `COGNITO_USER_POOLS` authorizer, API Gateway puts the verified JWT claims on `event.requestContext.authorizer.claims` — find the `sub` claim there, then query `users` by `cognito_sub` to get the internal `users.id` you'll scope everything to. Decide what happens if no matching `users` row exists (shouldn't happen if Phase 2 worked, but a Lambda should never assume its inputs are always valid).
- **Routing internally**: since this is a Lambda-proxy integration, one invocation could be any method/path under e.g. `/accounts/{proxy+}`. Look at `event.httpMethod` and `event.path` (or `event.pathParameters.proxy`) to decide: is this "list all", "get one by id", "create", "update one by id", or "delete one by id"? Decide your own path convention (e.g. `GET /accounts` = list, `GET /accounts/{id}` = get one).
- **The actual CRUD**, using Drizzle's query builder against `backend/src/db/schema.ts` — `select`/`insert`/`update`/`delete`, each filtered by the resolved `users.id` (via `eq(accounts.userId, userId)` or equivalent, alongside whatever other filter the operation needs).
- **What a Lambda-proxy integration must return**: a specific shape (`statusCode`, `body` as a JSON *string*, optionally `headers`) — API Gateway won't do anything sensible with a bare object or thrown error. Decide your error-response shape once and reuse it across all three Lambdas (e.g. what a 400 vs 404 vs 500 body looks like) — consistency here will matter once a frontend consumes this API in Phase 4.

**Transactions-specific:**
- On create/update, before writing anything: query the requesting user's own `accounts` and (if `category_id` is provided — it's nullable) `categories` tables to confirm the referenced `account_id`/`category_id` actually belong to them. Decide what HTTP status you return when they don't (a row that exists but belongs to someone else, vs. a row that doesn't exist at all, can reasonably get the same or different treatment — your call, just be consistent).
- No SQS enqueue call anywhere in this handler yet.

**Verify:** `cd backend && npx tsc --noEmit` passes for all three.

---

## Task 3: Wire the Lambdas into Terraform + build/package them

Figure out:
- A build script per Lambda (mirror `build-migrate.sh`/`build-post-confirmation.sh`) plus matching npm scripts — or, if you'd rather not write three near-identical bash scripts, consider whether one parameterized script makes sense here (your call, not required).
- Three `aws_lambda_function` resources (in `infra/modules/api` or a new file in that module), each VPC-attached the same way `migrate`/`post-confirmation` are, with their own IAM role (does each need its own role, or can they share one? think about what a shared role's blast radius would mean if one Lambda were ever compromised).
- Passing each Lambda's ARN into the corresponding `aws_api_gateway_integration` from Task 1.

**Verify:** `terraform plan` in `infra/envs/dev` now shows the full set: API Gateway, authorizer, deployment/stage, three Lambdas with their roles, and the three `aws_lambda_permission` grants — all as new resources, nothing from Phases 1/2 touched.

---

## Task 4: Apply and test end-to-end

Figure out:
- Apply it (`terraform apply`).
- Get the API's invoke URL (an `aws_api_gateway_stage` has one, or construct it from the REST API id + region + stage name — check what Terraform outputs, add one if it's missing).
- Get a JWT: open `scratch/auth-test.html` (from Phase 2), log in with a confirmed user, copy the `AccessToken` (or `IdToken` — check which claim shape your Lambdas actually need to read `sub` from; they may differ) from the page's output.
- Use curl, Postman, or Insomnia to hit each endpoint with `Authorization: Bearer <token>` (or whatever header/scheme the Cognito authorizer expects — check the docs for `identity_source` on `aws_api_gateway_authorizer`, it's not automatically the standard `Authorization` header unless you configure it that way).
- Exercise the full CRUD cycle for at least accounts and categories, then transactions including the cross-user-ownership rejection case (try referencing an `account_id` that isn't yours, or doesn't exist, and confirm you get the error you designed).

**Verify:**
- A request with no token (or a garbage token) is rejected by the authorizer before it ever reaches your Lambda (check CloudWatch logs — if your Lambda logs anything for that request, the authorizer isn't doing its job).
- A request with a valid token successfully lists/creates/updates/deletes rows, and those rows are correctly scoped — two different confirmed users should never be able to see or modify each other's data (test this explicitly if you have more than one confirmed test user, or set one up).

---

## Done When

`terraform apply` succeeds, and a full CRUD cycle against accounts, categories, and transactions works end-to-end through API Gateway using a real Cognito JWT — including transactions correctly rejecting a request that references another user's account or category, and unauthenticated requests being rejected by the authorizer before reaching any Lambda.

## Next Phase

Phase 4 (Frontend: React/Next app on S3+CloudFront — login, account list, transaction list/add/edit, category management, computed balances) — figure that out as its own pass once this one's done, using the spec's Learning Roadmap section as a starting point.
