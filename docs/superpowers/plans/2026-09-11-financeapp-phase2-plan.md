# FinanceApp Phase 2 (Auth) — Checklist

**Goal:** Add Cognito-based signup/login. A `PostConfirmation` Lambda trigger creates each new user's `users` row and seeds their default `categories`, matching the spec's Auth Flow.

**Spec:** `docs/superpowers/specs/2026-09-08-financeapp-design.md` — see "Auth Flow" and the Data Model's `categories` note (default set, seeded on signup).

This is a checklist of what to figure out and build yourself, not a set of answers to paste in. Ask if you get stuck on a specific step, or want something reviewed once you've written it.

## Global Constraints

- Stay free-tier eligible — no NAT Gateway, no new always-on paid resources.
- The Cognito app client is a **public client** (no client secret) — a static HTML page can't keep a secret safe.
- Out of scope for this phase: API Gateway, the Lambda JWT authorizer, and per-user query isolation on the CRUD tables. That's Phase 3.

---

## Task 1: Cognito user pool (Terraform)

**Files:** new module `infra/modules/auth/`, wired into `infra/envs/dev/main.tf` the same way `network`/`database`/`migrate` already are.

Figure out:
- The Terraform resources for a Cognito user pool (`aws_cognito_user_pool`) with email as the username/sign-in attribute, and **required email verification** (Cognito emails a confirmation code on signup; users can't log in until confirmed).
- An app client (`aws_cognito_user_pool_client`) with no generated secret, and whichever auth flow(s) you'll call from the test page (look at what `InitiateAuth` needs — you'll want `USER_PASSWORD_AUTH` or similar enabled explicitly, it's not on by default).
- What outputs this module should expose (user pool ID, app client ID) so `infra/envs/dev` and later phases can reference them.

**Verify:** `terraform plan` in `infra/envs/dev` shows the user pool + app client as new resources, nothing unexpected touched. Don't apply yet — Task 2's Lambda needs to exist first since the pool config in Task 3 will reference it.

---

## Task 2: The `post-confirmation` Lambda

**File:** `backend/src/lambdas/post-confirmation/handler.ts` (new — mirror the folder shape of `backend/src/lambdas/migrate/`).

Figure out:
- The shape of a Cognito `PostConfirmation` trigger event (check `@types/aws-lambda`'s `PostConfirmationConfirmSignUpTriggerEvent`, or the AWS docs) — specifically where the user's `sub` and `email` land in `event.request.userAttributes`, and what a trigger handler is expected to return.
- Reuse the DB connection setup from `backend/src/lambdas/migrate/handler.ts` (same `postgres`/`drizzle` pattern, same env vars) — this Lambda needs the same VPC/security-group access to reach RDS.
- Insert one row into `users` (`cognito_sub`, `email`, and `name` — decide where `name` comes from at signup; Cognito's standard attributes include `name` if you ask for it at signup, otherwise fall back to something reasonable).
- Insert the default `categories` rows for that new user — the spec names an example starter set (Groceries, Rent, Salary, Utilities, ...); check the Data Model section for the full list it gives, and decide the `kind` (income/expense) for each.
- What happens if this Lambda throws — Cognito's behavior on a `PostConfirmation` trigger failure is worth understanding before you rely on it (does the user's confirmation still succeed? Do you get retried?).

**Verify:** `cd backend && npx tsc --noEmit` passes.

---

## Task 3: Wire the trigger + build/package it

Figure out:
- How Terraform's `aws_lambda_function` resource for this new Lambda should look — same shape as `module.migrate`'s (check `infra/modules/migrate`), but a new function, new IAM role/policy (needs RDS/Secrets Manager access same as migrate; does it need anything migrate's role doesn't, or vice versa?).
- Whether you need a build step like `backend/scripts/build-migrate.sh` for this Lambda too (probably yes — bundle it the same way) and a matching npm script.
- How to point the Cognito user pool at this Lambda as its `PostConfirmation` trigger (`lambda_config` block on `aws_cognito_user_pool`), and the `aws_lambda_permission` Cognito needs to be allowed to invoke it.

**Verify:** `terraform plan` now shows the user pool, app client, IAM role, and Lambda function all as new resources with the trigger wired up. Read through it — check the Lambda's VPC config matches `migrate`'s (private subnets, same security group or one with equivalent RDS access).

---

## Task 4: Apply and do a real signup

This touches real AWS resources (new Cognito pool, new Lambda) but doesn't touch/replace anything from Phase 1.

Figure out:
- Apply it (`terraform apply` in `infra/envs/dev`).
- How to actually trigger a signup without a frontend yet — the AWS CLI has `aws cognito-idp sign-up` and `aws cognito-idp confirm-sign-up` commands; try one manually first as a sanity check before building Task 5's page.
- You'll receive a real confirmation code by email (Cognito's default email sending, no SES setup needed yet) — use it to confirm.

**Verify:**
- `aws logs tail` on the `post-confirmation` Lambda's log group shows it ran after you confirmed.
- Query the `users` and `categories` tables the same way you did in Phase 1 (via your migrate Lambda's query extension, or whatever method you settled on) and confirm the new user row and its seeded categories are there.

---

## Task 5: Throwaway test-harness page

**File:** somewhere clearly separate from real app structure — e.g. `backend/scripts/auth-test.html` or a top-level `scratch/` folder, your call, just don't make it look like the start of the real frontend.

Figure out:
- A plain HTML page with three forms (sign up, confirm code, log in) that calls Cognito's `SignUp`, `ConfirmSignUp`, and `InitiateAuth` APIs directly — the AWS SDK for JS v3 Cognito Identity Provider client can run in a browser via a CDN script tag; you'll need the user pool ID and app client ID from Task 1's Terraform outputs.
- Display whatever `InitiateAuth` returns on successful login (the JWT) somewhere visible on the page, so you can see it worked.

**Verify:** open the page locally, sign up with a real email you can check, confirm, log in, and see a JWT printed on the page.

---

## Done When

`terraform apply` succeeds, a real signup through the test-harness page (or the AWS CLI) results in a confirmed Cognito user, the `post-confirmation` Lambda's logs show it ran, and the `users`/`categories` tables have exactly the new user's row and their seeded default categories.

## Next Phase

Phase 3 (Core API: API Gateway REST + Lambdas for accounts/categories/transactions CRUD, Cognito JWT authorizer wired in, per-user isolation enforced) — figure that out as its own pass once this one's done, using the spec's Learning Roadmap section as a starting point.
