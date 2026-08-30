# Engineering Decisions

## 1. Delivery semantics: at-least-once

An event is persisted before the API responds and is retried after temporary failures. This reduces the risk of losing events, but duplicate deliveries remain possible. For example, a customer may process a request successfully while its response is lost on the network. The worker cannot observe that success and must retry.

Every delivery includes a stable `X-Webhook-Event-Id`. Customers should store processed event IDs and ignore duplicates. The service does not claim exactly-once delivery because an HTTP sender cannot guarantee it without cooperation from the receiver.

## 2. Retry behavior

Network errors, timeouts, HTTP `408`, `429`, and `5xx` are treated as temporary. Retries are scheduled after 5 seconds, 30 seconds, 2 minutes, 10 minutes, 30 minutes, 1 hour, 2 hours, and 4 hours. A ±20% jitter prevents many events from retrying simultaneously. After eight retries, the event becomes `failed`. Most `4xx` responses fail immediately because retrying an unchanged invalid request is unlikely to help.

## 3. Long outages and fairness

When an endpoint is down for six hours, its events remain `pending` and are selected only when `nextAttemptAt` becomes due. The worker does not retry in a tight loop. Each batch is limited to five concurrent events, allowing deliveries for other endpoints to continue. A production system should add a distributed queue, circuit breakers, per-customer concurrency limits, metrics, alerts, and a dead-letter queue or manual replay.

## 4. Ordering

Delivery order is not guaranteed. Concurrent delivery improves throughput and prevents one failing event from blocking later events. Customers should use event timestamps or versions when business state depends on ordering. Per-subscription ordering is possible, but it requires additional queue coordination and introduces head-of-line blocking.

## Additional decisions

- SQLite provides persistence with minimal setup and fits the single-process scope.
- Events left as `processing` are returned to `pending` when the worker starts. This supports at-least-once delivery and can produce duplicates after a crash.
- Separate in-memory IP rate limiters protect registration, ingestion, and status polling. They reset on restart and are unsuitable for multiple instances; production should use customer/API-key quotas with Redis or an API gateway.
- An optional `Idempotency-Key` prevents producer retries from creating another event.
- Localhost is allowed for the mock endpoint. Complete SSRF protection is deliberately outside the assignment scope.

## Timebox and scope

I used the assignment's three-hour cap as a hard scope boundary. Work started at approximately 17:10 WIB and the implementation, automated tests, and initial documentation were completed at approximately 19:00 WIB, for a total of about 1 hour and 50 minutes.

Within that timebox, I prioritized a complete vertical flow:

- Register a customer endpoint.
- Accept and persist an event before acknowledgment.
- Deliver it asynchronously through a background worker.
- Track pending, delivered, and failed outcomes.
- Retry temporary failures with bounded backoff and jitter.
- Protect inbound routes with separate rate limits.
- Verify core behavior through type checking, a production build, and automated tests.
- Document the selected decisions, trade-offs, and AI-assisted workflow.

I deliberately stopped short of production infrastructure and operational features such as authentication, webhook signing, complete SSRF protection, a distributed queue, distributed locking and rate limiting, per-customer fairness, metrics and alerts, dead-letter queues, and manual replay. With additional time, I would prioritize those items based on operational risk rather than expanding the assignment indiscriminately.
