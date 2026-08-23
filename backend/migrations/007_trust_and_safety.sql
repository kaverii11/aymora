-- Phase 6: trust, safety, compliance. See docs/backend-architecture-prompt.md section 8.

create table blocks (
  id             uuid primary key default gen_random_uuid(),
  blocker_id     uuid not null references users(id) on delete cascade,
  blocked_id     uuid not null references users(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on blocks (blocked_id);

create table reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references users(id) on delete cascade,
  reported_id    uuid not null references users(id) on delete cascade,
  reason         text not null,
  details        text,
  status         text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);

create index reports_status_idx on reports (status);
create index reports_reported_idx on reports (reported_id);

-- DPDP Act 2023: explicit, logged consent per policy version, and a durable
-- record of data-subject requests (export/deletion) with their fulfillment status.
create table consent_records (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  policy_version  text not null,
  consented_at    timestamptz not null default now(),
  ip_hash         text
);

create table data_subject_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  type          text not null check (type in ('export', 'deletion')),
  status        text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  requested_at  timestamptz not null default now(),
  completed_at  timestamptz
);
