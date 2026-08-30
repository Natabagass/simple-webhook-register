# Webhook Delivery Service

A small service that accepts events, persists them, and reliably delivers their JSON payloads to customer endpoints through a background worker.

## Quick start

Requirement: Node.js 20 or newer.

### Automatic demo

Use this command to quickly demonstrate temporary failure, retry, successful delivery, idempotency, and rate limiting:

```bash
npm install && npm run demo
```

The demo starts temporary servers, prints every result, and shuts them down automatically. It uses a 100 ms retry only for demonstration; the actual service keeps the documented production schedule.

### Run the actual service

The assignment's one-line run command is:

```bash
npm install && npm run dev
```

The service listens on `http://localhost:3000`. Every setting has a default value, so `.env` is optional. Copy `.env.example` to `.env` only when customization is needed.

### Run all verification checks

```bash
npm run verify
```

This runs TypeScript type checking, the production build, and all automated tests.

## Manual walkthrough

Start the mock customer in a second terminal:

```bash
npm run mock:customer
```

Register the mock endpoint:

```bash
curl -s -X POST http://localhost:3000/subscriptions \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://localhost:4000/webhook"}'
```

Copy the returned `id`, then create an event:

```bash
curl -s -X POST http://localhost:3000/events \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-order-123' \
  -d '{"subscriptionId":"SUBSCRIPTION_ID","payload":{"orderId":"order-123","status":"paid"}}'
```

Copy the returned `eventId`, then inspect delivery status:

```bash
curl -s http://localhost:3000/events/EVENT_ID
```

The status moves from `pending` to `delivered`, or to `failed` after a permanent error or exhausted retries.

## API

- `GET /health` — check service health.
- `POST /subscriptions` — register a customer URL.
- `POST /events` — persist and schedule an event.
- `GET /events/:eventId` — inspect delivery status.

`POST /events` accepts an optional `Idempotency-Key`. Repeating a request with the same subscription and key returns the original event instead of creating another one.

## How delivery works

1. The API validates and persists an event in SQLite.
2. It returns `202 Accepted` without waiting for the customer endpoint.
3. The worker claims at most five due events.
4. A `2xx` response marks an event `delivered`.
5. Timeouts, network failures, `408`, `429`, and `5xx` are rescheduled with increasing delays.
6. Other `4xx` responses or exhausted retries mark an event `failed`.

## Documentation

- Short decision record: [docs/DECISIONS.md](./docs/DECISIONS.md).
- Four required interview decisions: [docs/INTERVIEW_DECISIONS.md](./docs/INTERVIEW_DECISIONS.md).
- Detailed trade-off reference: [docs/TRADE_OFFS.md](./docs/TRADE_OFFS.md).
- Implementation and review guide: [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md).
- AI-assisted workflow: [docs/PROMPTS.md](./docs/PROMPTS.md).

## Verification

Run every verification step with one command:

```bash
npm run verify
```

Or run each step separately:

```bash
npm run typecheck
npm run build
npm run test:run
```

Tests do not access the internet. They use in-memory SQLite and mocked delivery responses.

## Scope boundary

This is a single-process assignment solution. Authentication, Redis, a message broker, a UI, production deployment, distributed rate limiting, and complete SSRF protection are not implemented. Before submission, export the complete AI conversation as required by the assignment.
