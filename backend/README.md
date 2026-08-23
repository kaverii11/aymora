# Aymora Backend

Implements all 6 phases from `docs/backend-architecture-prompt.md`: waitlist,
auth/onboarding, AI personality profiling (Gemini), matching engine, chat +
Plus subscriptions (Razorpay Test Mode), and trust & safety / DPDP compliance.

## Setup

```bash
npm install
cp .env.example .env      # fill in secrets (see below)
docker compose up -d      # Postgres (pgvector) + Redis
npm run migrate
npm run dev                # http://localhost:8787
```

`npm run dev` starts the HTTP API *and* the two background workers
(profile generation, match generation) in one process — fine for local dev;
split them for production.

## Required secrets

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — any random 32+ byte hex string.
- `GEMINI_API_KEY` — free key from https://aistudio.google.com/apikey. Without
  it, the profiling pipeline runs in **stub mode**: deterministic fake
  profiles/embeddings so everything downstream (matching, etc.) is still
  testable.
- `ADMIN_API_KEY` — any random string, gates `/api/admin/*`.

## Optional (features degrade gracefully without them)

- `RESEND_API_KEY` — without it, emails are logged to the console instead of
  sent (dev-mode "email").
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` — use
  **Test Mode** keys only (Razorpay dashboard). Without them, subscription
  checkout returns `501 payments_not_configured`; the waitlist-promo path
  (free Plus for the first 1,000 verified signups) works regardless.
- Phone OTP has no real-SMS path by design — see `src/providers/otp/index.ts`.
  Codes are logged, not sent.

## Layout

```
src/
  config.ts            env validation (zod) + feature flags
  server.ts / index.ts  Fastify app assembly + entrypoint (HTTP + workers)
  db/client.ts          pg Pool + query helpers + transaction helper
  lib/                  jwt, tokens, redis, pgvector, disposable-email list
  providers/            email (Resend/console), otp (mock), ai (Gemini),
                         payments (Razorpay test mode)
  modules/<name>/
    repository.ts        raw SQL
    service.ts            business logic
    routes.ts             Fastify handlers
  jobs/                  BullMQ queues + workers (profile + match generation)
migrations/              numbered plain-SQL migrations, applied by `npm run migrate`
```

## Smoke-tested flows (manually verified during development)

Waitlist signup → verify → live count; auth signup → magic-link → token
exchange → refresh; phone OTP start/verify; questionnaire → Gemini profile
generation (live) → match candidate generation (pgvector + rule-based
re-ranking) → mutual match → conversation → message; waitlist-promo Plus
auto-grant; block/unblock; report → admin review; privacy export.

## Known gaps / deliberate scope cuts

- No frontend integration yet — `index.html` still has the old fake
  client-side-only waitlist form. Wiring it to `POST /api/waitlist` and
  `GET /api/waitlist/count` is the next step.
- Admin auth is a single shared API key, not real RBAC (see
  `src/middleware/adminAuth.ts`).
- Chat is plain REST polling, not realtime (per the architecture doc's
  "keep it simple" call).
- Data export/deletion (`/api/privacy/*`) are self-service and synchronous;
  fine at MVP scale, would need to be queued at real scale.
