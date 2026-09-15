# FinanceApp Phase 4 (Frontend) — Checklist

**Goal:** A React/Next app on S3+CloudFront that logs a user in via Cognito and lets them manage accounts, categories, and transactions through the Phase 3 API — including computed account balances.

**Spec:** `docs/superpowers/specs/2026-09-08-financeapp-design.md` — see "Components" (the `frontend` row), Architecture Overview diagram, and Learning Roadmap phase 4 ("static hosting, CDN, CORS").

This is a checklist of what to figure out and build yourself, not a set of answers to paste in. Ask if you get stuck on a specific step, or want something reviewed once you've written it.

## Global Constraints

- Stay free-tier eligible — S3 + CloudFront's free tier covers a low-traffic personal project; no paid CDN features needed.
- No SQS/digest/Plaid in this phase — balances are computed client-side or via a request to the existing API, not from anything Phase 5/6 will add.
- The API (`invoke_url` output from Phase 3) is already live and Cognito-authorized — this phase is a consumer of it, not a change to it, except where CORS forces one (Task 1).

---

## Task 1: CORS — figure out the authorizer gotcha first

**Files:** likely `infra/modules/api/main.tf`, possibly each Lambda's Hono app.

Before writing any frontend code, figure out why a browser calling your API will fail even though curl/Postman worked fine in Phase 3's testing. Browsers send a CORS **preflight** `OPTIONS` request before the real one for most cross-origin calls — and your `{proxy+}` resources currently route `ANY` (which includes `OPTIONS`) through the Cognito authorizer. A preflight request has no `Authorization` header by design.

Figure out:
- What happens right now if a preflight `OPTIONS` request hits your `{proxy+}` resource — does it reach your Lambda, or does the authorizer reject it first? (Same kind of check as Phase 3's "no token → rejected before the Lambda" verification.)
- The two common fixes: (a) a separate, unauthorized `OPTIONS` method per resource (often a `MOCK` integration that just returns the right `Access-Control-Allow-*` headers), or (b) some other way to exempt preflight requests from the authorizer. Decide which fits your setup and why.
- Once preflight is handled, the actual `GET`/`POST`/etc. responses also need `Access-Control-Allow-Origin` (and friends) in their headers — Hono has CORS middleware that can add this from inside each Lambda; decide whether that's enough on its own or whether you still need the Terraform-level preflight fix too.

**Verify:** A `fetch()` from a page served on a different origin (even `file://` or `localhost:xxxx` during dev) succeeds against a live endpoint with a valid token, with no CORS error in the browser console — check with your browser's dev tools before assuming Postman/curl success means the browser will work too.

---

## Task 2: Frontend app — auth

**Files:** new top-level `frontend/` (or wherever you'd like the app to live).

Figure out:
- Framework/tooling choice (Next.js, Vite+React, plain CRA, etc.) — the spec says React/Next but doesn't mandate a specific setup; pick something you can statically export/build for S3.
- How to authenticate from the browser: you already have a working direct-`InitiateAuth` pattern (`scratch/get-token.sh`) — decide whether to replicate that in JS yourself, or use a library like `amazon-cognito-identity-js` or AWS Amplify's Auth module. Consider signup + email confirmation too, not just login (your `PostConfirmation` trigger depends on that flow completing).
- Where the resulting JWT lives client-side (memory vs. `localStorage` vs. cookies) and how it gets attached as `Authorization: Bearer <token>` on every API call — you'll want one shared API client/fetch wrapper rather than repeating this per component.
- What happens when the token expires (Cognito's `AccessToken`/`IdToken` are short-lived) — at minimum, decide what the UI does on a `401` from the API (redirect to login is the simplest option).

**Verify:** You can sign up a new user, confirm it, log in, and see it land in your `users` table (same as Phase 2/3's manual JWT testing, but now driven from the UI instead of a shell script).

---

## Task 3: Frontend app — accounts, categories, transactions

**Files:** same `frontend/` app.

Figure out, once, then repeat the shape for each of the three domains:
- A page/view listing the user's accounts (name, type, institution) with create/edit/delete.
- A page/view for categories (name, kind) with create/edit/delete.
- A page/view for transactions: list (probably the most-used screen), add, edit, delete — the add/edit form needs to let the user pick one of *their* accounts and (optionally) one of *their* categories, which means fetching those lists first.
- **Computed balances**: the spec says balances are computed on read, not stored. Decide whether that computation happens client-side (sum the `amount`s of transactions per account after fetching them) or via a request pattern that does it server-side — nothing in Phase 3's API currently returns a computed balance, so this is your call on where that logic lives.

**Verify:** Full CRUD through the UI for all three domains, with a visible account balance that updates when you add/edit/delete a transaction against that account.

---

## Task 4: S3 + CloudFront (Terraform)

**Files:** new module `infra/modules/frontend/`, wired into `infra/envs/dev/main.tf`.

Figure out:
- An S3 bucket configured for static website content — decide whether it's served directly as a public static site bucket, or (the more common modern pattern) kept private and only reachable through CloudFront via an Origin Access Control.
- A CloudFront distribution in front of that bucket — cache behavior, default root object, and how you want client-side routing (if your framework does SPA-style routing) to fall back to `index.html` instead of returning CloudFront's default 403/404 for unknown paths.
- How your build gets the right API base URL and Cognito pool/client IDs baked in — most frontend build tools support build-time env vars; decide how those get supplied (a `.env` file that's gitignored, Terraform output piped into the build step, etc.) so you're not hardcoding a specific API Gateway URL into source.
- How the build actually gets uploaded (`aws s3 sync` after `terraform apply` creates the bucket — this is a manual/scripted step outside Terraform's own apply, similar to how you build+zip Lambdas today).

**Verify:** `terraform plan` shows the new bucket/distribution/OAC as net-new resources, nothing else touched.

---

## Task 5: Deploy and test end-to-end

Figure out:
- Build the frontend, sync it to S3, and get the CloudFront distribution URL.
- Sign up, confirm, and log in for real through the deployed frontend (not localhost) — this is the first time the whole stack (CloudFront → browser → API Gateway → Lambda → RDS) is exercised together.
- Exercise the full CRUD cycle for accounts, categories, and transactions through the UI, confirming a balance updates correctly.

**Verify:** A fresh signup through the deployed CloudFront URL results in a working login, and every CRUD action in the UI reflects correctly against the real API — no CORS errors, no stale/incorrect balances.

---

## Done When

The CloudFront URL serves a working app: sign up → confirm → log in → create an account → add a transaction against it → see the account's balance reflect it → edit/delete work → categories are manageable — all without touching curl/Postman, and with no CORS errors in the browser console.

## Next Phase

Phase 5 (Event-driven layer: SQS + `notifications` Lambda + SES, DLQ, EventBridge weekly digest) — figure that out as its own pass once this one's done, using the spec's Learning Roadmap section as a starting point. Note the spec also has `transactions` enqueueing an SQS event on write, which was explicitly deferred out of Phase 3 — that wiring belongs in Phase 5, not here.
