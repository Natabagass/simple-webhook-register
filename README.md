# Webhook Delivery Service

Initial project setup for the Junior SE take-home assignment.

## Current status

Only the development environment has been prepared. The API, database schema,
delivery worker, retry policy, and tests have deliberately not been implemented
yet; they will follow the agreed development plan.

## Installed stack

- Node.js and TypeScript
- Express
- SQLite through `better-sqlite3`
- Zod
- `express-rate-limit`
- Vitest and Supertest
- `tsx` for local development

## Commands

```bash
npm run typecheck
npm run build
npm test
```

Copy `.env.example` to `.env` only when implementation begins.
