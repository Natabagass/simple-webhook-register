# AI Usage and Prompts

## Overview

AI was used as a collaborative engineering assistant while building this backend assignment. Its role included:

- Reading and breaking down the PDF requirements.
- Explaining backend concepts in plain language.
- Comparing delivery, retry, ordering, polling, and rate-limiting options.
- Creating a staged implementation plan.
- Assisting with the API, SQLite persistence, worker, retries, tests, and documentation.
- Running type checks, automated tests, production builds, and diff checks.

This file summarizes the workflow and representative prompts. It is **not a replacement for the complete conversation transcript** required by the assignment. The original transcript must still be exported without editing, summarizing, or removing any part of it.

## Project context

- Node.js 20 and TypeScript.
- Express 5.
- SQLite through `better-sqlite3`.
- Zod validation.
- `express-rate-limit` for inbound traffic protection.
- Vitest and Supertest.
- Requirements in `docs/Junior SE Test V2.pdf`.
- A time-boxed, single-process solution.

## 1. Requirement analysis

### Prompt

```text
Read docs/Junior SE Test V2.pdf and inspect the repository before changing
source code.

Separate:
1. Mandatory requirements.
2. Decisions deliberately left to the engineer.
3. Out-of-scope items.
4. Existing stack and configuration.
5. Missing implementation.
6. Key risks such as event loss, duplicate delivery, retry storms, slow
   endpoints, long outages, and excessive polling.
```

### How AI was used

AI extracted the PDF requirements, inspected the initial scaffold, and separated assignment requirements from production improvements.

### Result

The scope was limited to subscription registration, event ingestion, persistent storage, background delivery, retries, a status API, rate limiting, a mock customer, tests, and decision documentation.

## 2. Backend knowledge bridge

### Prompt

```text
Explain the webhook system from first principles using plain language that
matches my current knowledge while I learn backend engineering.

Explain the differences between:
1. The API and background worker.
2. Worker polling and client status polling.
3. Inbound rate limiting and outbound retry control.
4. Pending, processing, delivered, and failed.
5. At-most-once, at-least-once, and exactly-once.
6. Idempotency, ordering, timeout, backoff, jitter, batch, and concurrency.

Use concrete examples and define the assignment boundaries.
```

### How AI was used

AI converted backend terminology into the mental model of an API that records work, SQLite as a durable ledger, and a worker that performs delivery.

### Result

Delivery, retry, polling, and duplication concepts were reviewed before implementation decisions were finalized.

## 3. Architecture and implementation plan

### Prompt

```text
Create an implementation plan for the webhook delivery service and divide it
into small tasks with regular review checkpoints.

For each stage:
1. Explain in plain language what will be built.
2. Define the expected result.
3. Add a review checkpoint.
4. Separate assignment must-haves from production follow-up.
5. Avoid complexity that does not support the requirements.
```

### How AI was used

AI organized the work from configuration and persistence through APIs, worker delivery, retries, recovery, rate limits, tests, and documentation.

### Result

The staged plan and learning checkpoints are stored in `docs/IMPLEMENTATION_PLAN.md`.

## 4. API and persistence

### Prompt

```text
Implement the following contract with Express, Zod, and SQLite:

1. GET /health.
2. POST /subscriptions for HTTP/HTTPS destinations.
3. POST /events with a subscriptionId and JSON payload.
4. GET /events/:eventId for delivery status.
5. Return 202 Accepted from POST /events.
6. Support an optional Idempotency-Key for producer retries.
7. Use consistent JSON errors.

Persist an event before responding. Separate application creation from server
startup so the API remains easy to test.
```

### How AI was used

AI helped shape the schema, response contracts, input validation, public status representation, and transaction boundaries.

### Result

Subscriptions, events, and attempts are stored in SQLite. The API does not wait for the customer endpoint before responding to the producer.

## 5. Delivery worker and retry policy

### Prompt

```text
Implement a background delivery worker with these rules:

1. Poll SQLite every second.
2. Claim events in a transaction.
3. Select at most five events per batch.
4. Deliver concurrently without overlapping worker cycles.
5. Time out customer requests after five seconds.
6. Retry network errors, timeouts, 408, 429, and 5xx.
7. Retry after 5 seconds, 30 seconds, 2 minutes, 10 minutes, 30 minutes,
   1 hour, 2 hours, and 4 hours.
8. Add ±20% jitter.
9. Treat most 4xx responses as permanent failures.
10. Include a stable event ID header.
11. Recover processing events after restart.
```

### How AI was used

AI helped separate event claiming, HTTP delivery, error classification, scheduling, attempt recording, and crash recovery.

### Result

The worker provides at-least-once delivery within the single-process boundary and avoids tight retry loops when an endpoint is unavailable.

## 6. Rate limiting and polling protection

### Prompt

```text
Protect traffic without confusing API rate limits with worker retry controls.

Use separate per-route limits:
1. Registration: 10 requests per IP per minute.
2. Event ingestion: 100 requests per IP per minute.
3. Status polling: 300 requests per IP per minute.

Return 429 and Retry-After when a limit is exceeded. For pending events,
include suggestedPollAfterMs so clients do not poll too aggressively.
Document the limitations of an in-memory limiter.
```

### How AI was used

AI helped distinguish inbound API abuse from outbound retry storms and kept polling traffic from consuming the ingestion quota.

### Result

The API has basic per-IP protection. Worker retries are controlled separately by batch size, concurrency, timeout, backoff, jitter, and a retry limit.

## 7. Automated testing

### Prompt

```text
Add behavior-focused tests for:

1. Valid and invalid subscriptions.
2. Event ingestion and status.
3. Unknown subscriptions.
4. Idempotency-Key behavior.
5. Rate limiting and Retry-After.
6. Successful delivery and stable event headers.
7. Temporary failure followed by success.
8. Permanent 4xx failure.
9. Exhausted retries.
10. Recovery of interrupted processing events.

Use in-memory SQLite and short retry delays in tests. Do not make the test
suite wait for production retry intervals.
```

### How AI was used

AI identified high-risk behaviors, made worker dependencies replaceable in tests, and separated production build output from Vitest discovery.

### Result

Type checking, the production build, and all 12 automated tests passed.

## 8. Trade-off and interview documentation

### Prompt

```text
Create complete trade-off documentation for an interview walkthrough.

For each decision, explain:
1. The chosen option.
2. Why it was chosen.
3. Its benefits.
4. Its cost or weakness.
5. Alternatives not selected.
6. Production improvements.
7. The limits of what the assignment solution can claim.

Use plain but technically accurate language.
```

### How AI was used

AI reviewed the implementation and connected each code-level decision to its operational consequences.

### Result

`docs/DECISIONS.md` contains the required short decision record. Detailed notes are available in `docs/INTERVIEW_DECISIONS.md` and `docs/TRADE_OFFS.md`.

## 9. Final verification

### Prompt

```text
Perform a final review without expanding the agreed scope.

1. Run TypeScript type checking.
2. Run the production build.
3. Run all automated tests.
4. Check the diff for whitespace errors.
5. Confirm that README contains a one-line run command and API examples.
6. Do not claim any test that was not actually run.
7. Record remaining manual submission tasks.
```

### How AI was used

AI ran the checks and corrected test discovery so compiled test files were not counted twice.

### Result

- Type checking passed.
- Production build passed.
- All 12 automated tests passed.
- Setup, decisions, workflow, and production boundaries were documented.

## Human decisions and review

The following decisions were explicitly selected during planning:

- Keep the solution assignment-focused and time-boxed.
- Use separate per-route rate limits.
- Provide a minimal registration API.
- Use at-least-once delivery.
- Do not guarantee ordering.
- Keep retry coverage around eight hours.

Human review remains responsible for:

- Confirming that trade-offs fit real business requirements.
- Validating timeout, rate-limit, batch, and retry values against real traffic.
- Deciding whether the security boundary is acceptable.
- Confirming that producers and customers can use the API contract.
- Being able to explain the implementation without relying on AI.

## Engineer verification

AI-assisted changes were checked through:

- Source and diff review.
- TypeScript type checking.
- Automated tests.
- A production build.
- Whitespace-error checks.
- Verification that no credentials or secrets were introduced.
- Separation of assignment scope from production follow-up.

## AI-assisted workflow reflection

### What I learned

The most important learning was that webhook reliability is not achieved by retrying every failed request as quickly as possible. Reliability requires several controls working together:

- Persist the event before acknowledging it.
- Separate API ingestion from background delivery.
- Classify temporary and permanent failures differently.
- Use bounded retries with backoff, jitter, and timeouts.
- Keep a stable event ID because duplicate delivery is still possible.
- Protect inbound API traffic separately from outbound worker retries.

I also learned that at-least-once, retry behavior, long-outage handling, and ordering are connected decisions. Choosing at-least-once makes retries necessary; retries make duplicates and out-of-order delivery possible; long outages then require scheduling and fairness so one unavailable customer does not stop everyone else.

### Prompting strategy

The workflow was most effective when prompts were divided into three stages:

1. **Understand first:** inspect the requirement and repository, define unfamiliar terms, and identify decisions that cannot be answered by code inspection.
2. **Decide explicitly:** compare alternatives, state the selected trade-off, and define the assignment boundary before implementation.
3. **Implement and verify:** work in small stages, run checks after important changes, and compare the final behavior with the documented decisions.

Asking for plain-language explanations before implementation was useful because it made the final design easier to review and defend. Asking for task-by-task checkpoints also made it easier to detect when a feature was becoming larger than the assignment required.

### Most useful prompts

The most useful prompts were the ones that asked AI to:

- Explain the difference between API rate limiting and worker retry control.
- Compare at-most-once, at-least-once, and exactly-once before selecting one.
- Trace an event from `POST /events` through SQLite, the worker, and the status endpoint.
- Explain what happens during a six-hour outage and how other customers remain unaffected.
- Describe both the benefit and cost of every design decision.
- Keep production improvements documented but outside the time-boxed implementation.
- Write behavior-focused tests instead of targeting a coverage percentage.

### Challenges encountered

The main challenge was avoiding unnecessary production complexity while still making defensible reliability decisions. Technologies such as Redis, message brokers, circuit breakers, distributed locks, and metrics are relevant to a production webhook platform, but implementing all of them would exceed the assignment scope.

Another challenge was separating concepts that initially sounded similar:

- Worker polling versus client status polling.
- Inbound rate limiting versus outbound retry backoff.
- Producer idempotency versus customer-side webhook deduplication.
- Persisting an accepted event versus guaranteeing that a customer eventually processes it.

The implementation therefore keeps a narrow single-process design and documents where that design stops being sufficient.

### How AI output was reviewed

AI suggestions were not accepted only because they sounded plausible. The implementation was checked against the PDF requirements and the actual source code. Generated changes were reviewed through TypeScript type checking, automated tests, a production build, and diff inspection.

AI also proposed alternatives that were deliberately not implemented. Those ideas were kept as production follow-up rather than presented as completed features. This distinction is important because documentation should describe actual behavior, not an idealized future system.

### What I would improve next time

For a future assignment, I would establish the public API contract and the four required design decisions even earlier, then implement the smallest vertical slice from ingestion to successful delivery before adding retries and protection mechanisms.

With more time, I would also add:

- A real HTTP integration test for timeout and disconnect behavior.
- Payload-hash validation for reused idempotency keys.
- Graceful shutdown that drains in-flight delivery attempts.
- Per-customer concurrency and fairness.
- Metrics for queue depth, oldest pending event, retry rate, and delivery latency.
- A dead-letter queue and authorized manual replay.

These improvements would increase confidence and operational visibility, but they do not change the core decisions demonstrated by the assignment.

## Submission reminder

`PROMPTS.md` documents the workflow, but the assignment also requests the complete exported conversation. Export the original conversation as a separate file without editing, summarizing, or removing any part of it.
