-- Phase 2: identity & onboarding. See docs/backend-architecture-prompt.md section 4.

create table users (
  id                  uuid primary key default gen_random_uuid(),
  waitlist_entry_id   uuid references waitlist_entries(id) on delete set null,
  email               citext unique not null,
  phone               text unique,
  phone_verified_at   timestamptz,
  password_hash       text,
  date_of_birth       date not null,
  gender              text,
  seeking             text[] not null default '{}',
  city                text,
  onboarding_status   text not null default 'invited'
                        check (onboarding_status in (
                          'invited', 'questionnaire_started', 'questionnaire_complete',
                          'profile_generated', 'active', 'paused', 'banned'
                        )),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index users_onboarding_status_idx on users (onboarding_status);

-- Enforce 18+ at the DB level as a last line of defense (the API also checks this).
alter table users add constraint users_min_age_18
  check (date_of_birth <= (current_date - interval '18 years'));

-- Email magic-link / OTP-over-email auth (Phase 2 auth decision: no SMS OTP).
create table email_auth_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    text not null,
  purpose       text not null check (purpose in ('login', 'signup_verify')),
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index email_auth_tokens_user_idx on email_auth_tokens (user_id);

-- Mock phone-OTP provider (Phase 2 decision: fake SMS, code logged not sent).
-- Kept as a real table/flow so swapping in a live SMS provider later is a
-- provider-config change, not a schema change.
create table phone_otp_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  phone         text not null,
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      int not null default 0,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index phone_otp_codes_user_idx on phone_otp_codes (user_id);

create table refresh_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  token_hash    text not null unique,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index refresh_tokens_user_idx on refresh_tokens (user_id);
