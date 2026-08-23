-- Phase 5: conversation & Plus subscription. See docs/backend-architecture-prompt.md section 7.

create table conversations (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null unique references matches(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  sender_id        uuid not null references users(id) on delete cascade,
  body             text not null check (char_length(body) between 1 and 4000),
  created_at       timestamptz not null default now()
);

create index messages_conversation_idx on messages (conversation_id, created_at);

create table subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references users(id) on delete cascade,
  plan                      text not null default 'plus' check (plan in ('plus')),
  status                    text not null default 'active'
                              check (status in ('active', 'cancelled', 'expired', 'past_due')),
  source                    text not null check (source in ('waitlist_promo', 'razorpay')),
  razorpay_customer_id      text,
  razorpay_subscription_id  text unique,
  current_period_end        timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  unique (user_id, plan)
);

-- Raw Razorpay webhook events, kept for audit/replay/debugging. Processing is
-- idempotent on razorpay_event_id (see src/modules/subscriptions/webhook.ts).
create table payment_events (
  id                 uuid primary key default gen_random_uuid(),
  razorpay_event_id  text not null unique,
  event_type         text not null,
  payload            jsonb not null,
  processed_at       timestamptz,
  created_at         timestamptz not null default now()
);
