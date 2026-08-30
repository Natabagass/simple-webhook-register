# Implementation Plan and Review Guide

This document divides the backend into small, reviewable stages. A simple analogy is: the API is the cashier that records an order, SQLite is the ledger, and the worker is the courier that delivers it.

## Terminology

- **Producer:** an internal application that creates an event.
- **Subscription:** a customer identifier paired with a webhook destination.
- **Event:** the JSON data that must be delivered.
- **Worker:** a background process that delivers events.
- **Worker polling:** the worker checks the database every second.
- **Status polling:** a client periodically calls the status endpoint.
- **Retry:** another delivery attempt after a temporary failure.
- **Rate limit:** a limit on requests entering the API.

## Stage 1 — Application foundation

- [x] Separate Express application creation from server startup.
- [x] Validate environment configuration.
- [x] Add `GET /health` and consistent JSON errors.
- [x] Initialize SQLite tables automatically.

What was built: an HTTP entry point and persistent storage.

Review checkpoint:

- Run `npm run typecheck`.
- Call `/health` and confirm `{ "status": "ok" }`.
- Restart the service and confirm SQLite retains old events.

## Stage 2 — Register destinations

- [x] Implement `POST /subscriptions`.
- [x] Accept `http` and `https` URLs.
- [x] Reject malformed bodies and unsupported URL schemes.

What was built: each customer destination receives a subscription ID. Producers reference the ID instead of supplying an arbitrary URL with every event.

Review checkpoint:

- Register a valid mock URL.
- Submit an `ftp://...` URL and confirm a `400` response.

## Stage 3 — Accept and inspect events

- [x] Implement `POST /events` with `202 Accepted`.
- [x] Persist an event as `pending` before responding.
- [x] Implement `GET /events/:eventId`.
- [x] Support an optional `Idempotency-Key`.

What was built: the API records work without waiting for the customer endpoint, so a slow customer does not delay the producer request.

Review checkpoint:

- Create an event and inspect its initial status.
- Send two requests with the same idempotency key and confirm the event ID is unchanged.
- Use an unknown subscription and confirm a `404` response.

## Stage 4 — Delivery worker

- [x] Check for due events every second.
- [x] Claim at most five events per batch.
- [x] Deliver the batch concurrently.
- [x] Apply a five-second timeout.
- [x] include a stable event ID header.
- [x] Record every delivery attempt.

What was built: a background courier. Batch and timeout limits prevent one slow endpoint from consuming unlimited worker capacity.

Review checkpoint:

- Start the mock customer and create an event.
- Confirm that the mock receives the payload and event ID.
- Confirm the event becomes `delivered`.

## Stage 5 — Controlled retries

- [x] Retry network errors, timeouts, `408`, `429`, and `5xx`.
- [x] Fail most `4xx` responses without retrying.
- [x] Use increasing delays over approximately eight hours.
- [x] Add ±20% jitter.
- [x] Mark an event `failed` when all retries are exhausted.

What was built: failures are scheduled in the database rather than retried in a tight loop.

Review checkpoint:

- Run `MOCK_FAILURES_BEFORE_SUCCESS=2 npm run mock:customer`.
- Observe two failures followed by a successful delivery.
- Remember: rate limiting controls inbound API traffic, while backoff controls outbound retries.

## Stage 6 — Recovery and traffic protection

- [x] Recover `processing` events after a worker restart.
- [x] Prevent overlapping worker cycles.
- [x] Limit registration to 10 requests/IP/minute.
- [x] Limit event ingestion to 100 requests/IP/minute.
- [x] Limit status polling to 300 requests/IP/minute.
- [x] Return `429` and `Retry-After` when a limit is exceeded.

What was built: the service can resume interrupted work and has basic protection against excessive requests.

Review checkpoint:

- Understand that the current limiter supports only one process.
- Multiple instances would require Redis or an API gateway.
- Authentication and API keys remain outside the assignment scope.

## Stage 7 — Tests and documentation

- [x] Test registration, validation, ingestion, status, and idempotency.
- [x] Test successful delivery, retry, permanent failure, and recovery.
- [x] Test rate limiting.
- [x] Provide a mock customer.
- [x] Document setup and engineering decisions.
- [ ] Export the complete AI transcript before submission.

Final checkpoint:

```bash
npm run typecheck
npm run build
npm run test:run
```

Demonstrate three cases: immediate success, temporary failure followed by success, and permanent failure.

## Production follow-up

The time-boxed implementation deliberately excludes authentication, Redis/message brokers, multiple worker instances, distributed rate limiting, per-customer circuit breakers, metrics and alerts, manual replay, a UI, deployment, and complete SSRF protection.
