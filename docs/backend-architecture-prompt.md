# Aymora — Backend & System Architecture Spec

> **Purpose of this document:** a self-contained prompt you can hand to a developer, an AI coding
> agent, or a future Claude Code session to actually build the backend. It assumes zero prior
> context beyond this repo. Everything below is derived from `index.html` — the only artifact
> that currently exists — plus the product commitments implied by its copy.

---

## 0. Ground truth: what exists today

- **Repo contents:** `index.html` (single static file, inline CSS/JS), `assets/logo-full.jpg`,
  `assets/logo-icon.jpg`. No build tooling, no package.json, no server, no database, no `.env`.
- **What the page claims to a visitor:**
  - "AI matchmaking for India's 200M+ daters."
  - Signup collects only an email (`#email-input`, `type=email`, `required`).
  - "Free Aymora Plus for the first 1,000. Spots counted **at email verification**." — i.e. the
    product has already promised a verification step and a scarcity-ranked waitlist, neither of
    which exist.
  - "1,247 on the list" — hardcoded in the nav badge and the Plus banner. Not real data.
  - Product mechanics promised for the actual app (post-waitlist): (1) a questionnaire, (2) an AI
    personality profile built from it, (3) mutual-interest-gated introductions ("no swiping").
  - "Privacy by default" is stated as a value, not yet backed by any implementation.
- **What's fake right now:** `handleWaitlistSubmit()` does `e.preventDefault()` and swaps DOM
  visibility. No network call. No data is persisted anywhere. Refreshing the page loses the
  "signup."
- **No analytics, no error tracking, no rate limiting, no bot protection.**

This spec closes that gap in phases. **Phase 1 is the only phase needed to make the current page
honest.** Everything after that is the real product.

---

## 1. Phasing overview

| Phase | Goal | New user-facing capability |
|---|---|---|
| 1 | Real waitlist | Signup persists, double opt-in email verification, real live count |
| 2 | Identity & onboarding | Account creation, phone OTP, the questionnaire |
| 3 | AI personality profiling | Questionnaire → structured personality vector |
| 4 | Matching engine | Candidate generation, compatibility scoring, mutual opt-in introductions |
| 5 | Conversation & Plus | Unlocked chat after mutual match, subscription billing (Razorpay) |
| 6 | Trust, safety, compliance | Reporting/blocking, DPDP Act 2023 compliance, moderation queue |

Build in order. Do not start Phase 3's ML work before Phase 1/2 are boring and solid — the
waitlist is the only thing currently under real user load risk (bot spam, list-position gaming).

---

## 2. Recommended stack (and why)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Keep static HTML/CSS for the marketing page; add Next.js (App Router) only when Phase 2 needs authenticated, dynamic pages | No reason to rewrite a page that works. Don't introduce a framework until there's app logic to justify it. |
| API | Node.js + TypeScript, Fastify or Hono | Small footprint, fast, first-class TS. Avoid a GraphQL layer — the domain doesn't need it yet and it adds ops overhead for a pre-PMF product. |
| Database | PostgreSQL (Supabase or RDS) | Relational integrity matters here (waitlist rank, match state machines, subscription status). Supabase also gives you row-level security and a hosted auth option if you want to skip building phone-OTP infra yourself. |
| Vector search (Phase 3+) | `pgvector` extension on the same Postgres instance | Avoid standing up a separate vector DB (Pinecone/Weaviate) until scale actually demands it — one fewer system to run, and Postgres transactional guarantees keep profile writes and vector writes consistent. |
| Cache / queues | Redis (rate limiting, verification token TTLs, background job queue via BullMQ) | |
| AI / personality inference | Claude API (Messages API), structured output via tool-use/JSON schema | Use Claude to turn free-text/likert questionnaire answers into a structured personality profile object, not to "chat" — keep it a deterministic pipeline step, not a live conversational feature, for cost and reliability. |
| Transactional email | Resend or Postmark | Needed immediately for Phase 1 (verification links). Both have solid deliverability for India; avoid raw SMTP. |
| Phone OTP (Phase 2) | MSG91 or Twilio Verify | MSG91 has better India deliverability/pricing; Twilio if you want one vendor globally. |
| Payments (Phase 5) | Razorpay | UPI + card support, standard for Indian consumer apps; Stripe does not support UPI. |
| Hosting | Frontend: Vercel or Cloudflare Pages. API: Fly.io, Railway, or a single small VM behind Cloudflare — anything that lets you pin a region in India (`ap-south-1` / Mumbai) for data residency. | |
| Observability | Sentry (errors), PostHog (product analytics, self-hostable if data residency becomes a concern) | The current site has literally zero instrumentation — you don't even know your real signup conversion rate. |

---

## 3. Phase 1 — Real waitlist (build this first)

### 3.1 Data model

```sql
create table waitlist_entries (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  status            text not null default 'pending_verification'
                       check (status in ('pending_verification','verified','removed')),
  verification_token_hash text,             -- store a hash, never the raw token
  token_expires_at  timestamptz,
  verified_at       timestamptz,
  rank              int,                    -- assigned only on verification (see 3.3)
  referral_code     text unique,            -- optional, for Phase 1.1 growth loop
  referred_by       uuid references waitlist_entries(id),
  utm_source        text,
  utm_campaign      text,
  ip_hash           text,                   -- hashed, for abuse detection only
  user_agent        text,
  created_at        timestamptz not null default now()
);

create index on waitlist_entries (status);
create index on waitlist_entries (rank);
```

Why `rank` is assigned at verification, not at signup: the page copy explicitly says "Spots
counted at email verification" — an unverified row must never occupy a scarce Plus slot.

### 3.2 API endpoints

```
POST /api/waitlist
  body: { email: string, utm_source?, utm_campaign?, referral_code? }
  - validate email format server-side (don't trust the client)
  - rate limit: 5 requests / hour / IP, 1 pending signup / email
  - insert row (status=pending_verification), generate a random 32-byte token,
    store only sha256(token), email a verification link containing the raw token
  - respond 202 regardless of whether the email already exists (don't leak
    which emails are registered)

GET /api/waitlist/verify?token=...
  - hash the incoming token, look up matching non-expired row
  - on match: status=verified, verified_at=now(), assign next sequential rank
    inside a transaction (select ... for update on a counter row, or use a
    Postgres sequence) so ranks never collide under concurrent verifications
  - redirect to a "you're #N on the list" confirmation page
  - token TTL: 24h; expired tokens get a "resend" affordance, not a dead end

GET /api/waitlist/count
  - returns { verified_count: number }
  - this is what the nav badge and Plus banner should render instead of the
    hardcoded "1,247" — cache it in Redis with a 30–60s TTL, it does not need
    to be real-time
```

### 3.3 Frontend change required now

Replace the two hardcoded `1,247` strings and `handleWaitlistSubmit()`'s fake success path with:
a real `fetch('/api/waitlist', {method:'POST', body: JSON.stringify({email})})` call, and a
`fetch('/api/waitlist/count')` on page load to populate the badge. Keep the optimistic UI (show
success immediately after the POST resolves 202) but the count badge must come from the API, not
be baked into the HTML — right now it's a static lie that never changes as people actually sign up.

### 3.4 Abuse controls (must ship with Phase 1, not after)

- IP + email rate limiting (Redis token bucket).
- A honeypot field (hidden input bots fill, humans don't) — cheaper than a CAPTCHA and
  invisible to real users; add hCaptcha/Turnstile only if honeypot proves insufficient.
- Disposable-email domain blocklist (e.g. `mailchecker` list) — a waitlist promising a scarce
  perk to "the first 1,000" is a direct incentive to game it with throwaway addresses.

---

## 4. Phase 2 — Identity & onboarding

### 4.1 Data model additions

```sql
create table users (
  id                uuid primary key default gen_random_uuid(),
  waitlist_entry_id uuid references waitlist_entries(id),
  phone             text unique,           -- E.164, verified via OTP
  phone_verified_at timestamptz,
  email             citext unique not null,
  date_of_birth     date not null,          -- enforce 18+ at signup (site copy commits to this)
  gender            text,
  seeking           text[],                 -- who they're open to matching with
  city              text,
  onboarding_status text not null default 'invited'
                       check (onboarding_status in
                       ('invited','questionnaire_started','questionnaire_complete',
                        'profile_generated','active','paused','banned')),
  created_at        timestamptz not null default now()
);
```

### 4.2 Auth approach

Phone OTP as the primary factor (standard for Indian dating/social apps, reduces fake accounts
vs. email-only). Email stays attached from the waitlist row for continuity. Issue short-lived
JWTs (access token 15 min, refresh token 30 days, refresh rotation) or delegate entirely to
Supabase Auth if using Supabase for Postgres — don't hand-roll session management if you can
avoid it.

### 4.3 Questionnaire

Store as versioned, structured data — not free text dumped into one column — so the Phase 3
pipeline has something reliable to consume and so you can iterate on question wording without
breaking historical rows:

```sql
create table questionnaire_versions (
  id       uuid primary key default gen_random_uuid(),
  version  int not null,
  schema   jsonb not null   -- question id, type (likert/free_text/multi_select), prompt text
);

create table questionnaire_responses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id),
  version_id    uuid not null references questionnaire_versions(id),
  answers       jsonb not null,   -- { question_id: answer }
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);
```

---

## 5. Phase 3 — AI personality profiling

Pipeline, triggered on `questionnaire_responses.completed_at` being set:

1. Background job (BullMQ) picks up the completed response.
2. Send the structured answers to Claude with a fixed system prompt and a **strict JSON output
   schema** (use tool-use / forced JSON, not free-form prose) covering dimensions like: core
   values, communication style, attachment tendencies, dealbreakers, relationship goals. Treat
   this as a deterministic data-transformation step — pin the model version you validate against,
   don't silently float to "latest."
3. Store the structured profile *and* derive an embedding from it (Claude for the structured
   extraction; a dedicated embeddings model, or Voyage AI embeddings, for the vector — don't
   conflate profile generation with embedding generation, they're different jobs).

```sql
create table personality_profiles (
  user_id        uuid primary key references users(id),
  profile        jsonb not null,       -- structured dimensions from the LLM
  embedding      vector(1024),         -- pgvector column
  model_version  text not null,        -- which model/prompt version produced this
  generated_at   timestamptz not null default now()
);
create index on personality_profiles using ivfflat (embedding vector_cosine_ops);
```

Never regenerate a profile silently on every questionnaire edit without versioning — a user's
match history should be explainable against the profile version that produced it.

---

## 6. Phase 4 — Matching engine

Two-stage, not single-shot nearest-neighbor:

1. **Candidate generation:** `pgvector` cosine similarity search over `personality_profiles`,
   pre-filtered by hard constraints (age range, `seeking`, city/distance, not already
   matched/rejected each other, not blocked). Cap at ~50 candidates.
2. **Compatibility scoring:** re-rank those candidates with an explicit, explainable scoring
   function — a mix of embedding similarity + rule-based weights (shared dealbreakers = hard
   filter, not a score penalty; complementary vs. similar traits weighted per dimension). Keep
   this scoring function inspectable and testable; resist making the whole thing an opaque LLM
   call end-to-end, since you'll need to explain/debug bad matches.

```sql
create table match_candidates (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id),
  candidate_id uuid not null references users(id),
  score        numeric not null,
  status       text not null default 'pending'
                  check (status in ('pending','interested','passed','expired')),
  presented_at timestamptz,
  decided_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (user_id, candidate_id)
);
```

Introduction fires only when both directions of a pair are `interested` — poll for this
symmetrically or use a Postgres trigger that checks the reverse row on insert/update. "One
intentional introduction at a time" (site copy) implies you should throttle how many pending
`match_candidates` a user has open simultaneously — surface one at a time, not a deck.

---

## 7. Phase 5 — Conversation & Plus subscription

- `conversations` + `messages` tables, created only on mutual match, id'd by the `match_candidates`
  pair. Keep chat infra simple (Postgres + polling or a lightweight WebSocket via a service like
  Ably/Pusher) — don't build custom realtime infrastructure for an MVP.
- `subscriptions` table tracking Plus status, tied to Razorpay subscription/customer IDs via
  webhook (`razorpay.subscription.charged`, `.cancelled`, etc.) — never trust client-side
  "I paid" state.
- Honor the "Free Plus for the first 1,000" promise by checking `waitlist_entries.rank <= 1000`
  at the point a `users` row is created from that waitlist entry, and auto-provisioning a
  `subscriptions` row with `source='waitlist_promo'` — don't make it a manual/support-driven process.

---

## 8. Phase 6 — Trust, safety, compliance (do not ship Phase 4/5 publicly without this)

- **Reporting & blocking:** `reports` and `blocks` tables; a block must immediately exclude the
  blocked user from future `match_candidates` generation in both directions.
- **DPDP Act 2023 (India):** this product processes sensitive personal data (dating/relationship
  info) about Indian residents — plan for: explicit consent capture at signup with logged
  consent text/version, a data principal grievance/contact mechanism, data export and deletion
  endpoints, and hosting the primary data store in an India region (`ap-south-1` or an Indian
  cloud region) rather than assuming US-East is fine.
- **Age verification:** DOB is self-reported at signup (section 4.1) — decide explicitly whether
  that's sufficient for launch or whether you need a stronger check before allowing messaging;
  don't leave it implicit.
- **PII handling:** hash IPs and any abuse-detection fields at rest (already reflected in the
  Phase 1 schema); encrypt phone numbers at rest if your Postgres provider doesn't do this by
  default.

---

## 9. What to build first, concretely

If you're picking up this doc to start work: **implement Phase 1 end-to-end before anything
else.** It's small (one table, three endpoints, one email template), it fixes the fact that the
live page is currently lying to visitors about a persistent waitlist and a real headcount, and it
gives you actual signal (real signup numbers, real conversion rate) before you invest in the AI
matching pipeline in Phases 3–4.
