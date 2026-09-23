# FinanceApp Phase 5 (Event-Driven Layer) — Checklist

**Goal:** Transactions writes enqueue an async event; a weekly EventBridge-scheduled job summarizes each user's spending and emails it via SES through an SQS-backed notification pipeline with a dead-letter queue.

**Spec:** `docs/superpowers/specs/2026-09-08-financeapp-design.md` — see "Async / Event-Driven Flow", the `digest`/`notifications` rows in "Components", and Learning Roadmap phase 5 ("async messaging, event-driven design, scheduled jobs").

This is a checklist of what to figure out and build yourself, not a set of answers to paste in. Ask if you get stuck on a specific step, or want something reviewed once you've written it.

## Global Constraints

- Stay free-tier eligible where possible — SQS/EventBridge/SES all have generous free tiers at this traffic level.
- Networking: `digest` is VPC-attached (needs RDS) and also needs to reach SQS's public API — the spec's answer is a single-AZ SQS **VPC interface endpoint** (~$7-8/mo) instead of a NAT Gateway (~$32/mo), same tradeoff already made elsewhere in this repo. `notifications` (SQS-triggered, calls SES) doesn't touch RDS and isn't VPC-attached.
- No Plaid/`plaid-sync`/`plaid-webhook` in this phase — that's Phase 6.
- SES starts in sandbox mode (can only send to verified addresses) unless you request production access — fine for a personal project; verify your own email as a sender/recipient.

---

## Task 1: SQS queue + DLQ (Terraform)

**Files:** new module `infra/modules/async/`, wired into `infra/envs/dev/main.tf`.

Figure out:
- An SQS queue (`notification-events`) and a dead-letter queue (`notification-events-dlq`), linked via a redrive policy — decide `maxReceiveCount` (the spec says "retry per SQS redrive policy, then land in a DLQ after N failures").
- Visibility timeout — should be longer than however long the `notifications` Lambda takes to process one message, or SQS will redeliver a message that's still being processed.
- The **VPC interface endpoint** for SQS mentioned in Global Constraints — where does it go (which module), and which resources need their security groups updated to reach it.
- IAM: what permissions does the `digest` Lambda need to *send* to this queue, and what does `notifications` need to *receive/delete* from it.

**Verify:** `terraform plan` shows the new queue/DLQ/endpoint as net-new resources, nothing else touched.

---

## Task 2: Close out the Phase 3 deferral — `transactions` enqueues on write

**Files:** `backend/src/lambdas/transactions/handler.ts`, `infra/modules/api/main.tf` (transactions Lambda's IAM role + env vars).

The spec says `transactions` enqueues an SQS event on write — this was explicitly deferred out of Phase 3 into this phase. Figure out:
- What should the message body contain? (Enough for a consumer to know what changed — user id, transaction id, and the operation type (`create`/`update`/`delete`) is a reasonable minimum — your call on the exact shape.)
- Does this need to be `notification-events`, or does it make more sense as its own queue since it's a different kind of event than the weekly digest? (The spec's diagram shows `transactions` → RDS → SQS as its own arrow, separate from the `digest` → SQS arrow — decide whether that implies two queues or one.)
- `transactions` is already VPC-attached (needs RDS) — does it now also need the SQS VPC interface endpoint route from Task 1, same as `digest` will?
- IAM: the transactions Lambda's role needs `sqs:SendMessage` added.
- Where in `handler.ts` does the enqueue happen — after a successful DB write, before returning the response? What happens to the request if the enqueue itself fails (should a failed SQS send fail the whole API request, or just get logged)?

**Verify:** create/update/delete a transaction through the API (or frontend) and confirm a message actually lands in the queue — check via `aws sqs receive-message` (without deleting it, so you can inspect the body) or the CloudWatch queue depth metric.

---

## Task 3: `digest` Lambda (EventBridge-scheduled)

**Files:** new `backend/src/lambdas/digest/handler.ts` + build script (follow the pattern of the other Lambda build scripts in `backend/package.json`/`backend/scripts/`), Terraform for the Lambda + EventBridge rule (new module, or added to `infra/modules/async/` — your call).

Figure out:
- Query: for each user, sum transaction amounts by category for the past week — what's "past week" relative to when the rule fires (see EventBridge schedule below)?
- Output shape: the spec says it "enqueues one message per user onto `notification-events`" — so this Lambda doesn't send email itself, it just computes and enqueues; `notifications` (Task 4) does the actual sending. What does that per-user message need to contain for `notifications` to build an email from it?
- Users with zero transactions that week — enqueue an empty/zero digest, or skip them entirely? Either is defensible; make a call and note why.
- EventBridge scheduled rule: the spec suggests "Sunday evenings" — write the `cron()` or `rate()` expression, and confirm what timezone EventBridge schedule expressions run in (this trips people up).
- IAM: EventBridge needs permission to invoke this Lambda; the Lambda needs `sqs:SendMessage` and RDS access (VPC-attached, plus the SQS VPC endpoint route from Task 1).

**Verify:** manually invoke the Lambda (`aws lambda invoke`, bypassing the schedule) against real data and confirm the right number of messages land in the queue with correct per-user summaries — don't wait for Sunday to find out it's broken.

---

## Task 4: `notifications` Lambda (SQS consumer → SES)

**Files:** new `backend/src/lambdas/notifications/handler.ts` + build script, Terraform for the Lambda + SQS event source mapping.

Figure out:
- SQS trigger: an `aws_lambda_event_source_mapping` from `notification-events` to this Lambda — what batch size makes sense (processing messages one-by-one vs. in batches changes your error-handling story)?
- SES: verify a sender identity (and recipient, if still in sandbox) in the SES console/CLI before writing code. Build an email (plain text is fine to start) from the digest message shape you defined in Task 3.
- Error handling: if SES send fails for one message in a batch, what happens to the rest of the batch? (Look into partial batch failure reporting for SQS-Lambda event source mappings — returning the wrong shape here silently drops or endlessly-retries messages.)
- IAM: `ses:SendEmail` permission, plus whatever the event source mapping needs.
- This Lambda is NOT VPC-attached per the spec (doesn't touch RDS) — confirm your Terraform reflects that (no `vpc_config` block), since attaching it unnecessarily would require it to also route through the SQS VPC endpoint or a NAT gateway to reach SES.

**Verify:** manually push a test message onto the queue (`aws sqs send-message`) shaped like what `digest` would produce, and confirm a real email arrives.

---

## Task 5: Prove the DLQ actually works

**Files:** none new — this is a deliberate-failure test, not a feature.

Figure out:
- A way to make `notifications` fail deterministically (bad SES recipient, a temporary code change that throws, whatever's easiest to do and undo) and push a message that will fail every retry.
- Watch it retry per your Task 1 redrive policy, then confirm it actually lands in `notification-events-dlq`.
- Add a CloudWatch Alarm on `ApproximateNumberOfMessagesVisible` for the DLQ (the spec calls for "DLQ depth > 0" alarms) — this is a small preview of Phase 7 (Observability), fine to do now since it's directly tied to what you just built.

**Verify:** the DLQ has exactly the message you forced to fail, and (if you wired the alarm) it fires.

---

## Done When

A real transaction write visibly enqueues a message (Task 2), and — without waiting for the real Sunday schedule — manually invoking `digest` produces per-user messages that `notifications` turns into actual emails via SES (Tasks 3-4), and you've watched a deliberately-broken message survive retries and land in the DLQ (Task 5).

## Next Phase

Phase 6 (Plaid Sandbox integration: Plaid Link in the frontend, `plaid_items` table, `plaid-webhook` + `plaid-sync` Lambdas) — figure that out as its own pass once this one's done, using the spec's Learning Roadmap section as a starting point.
