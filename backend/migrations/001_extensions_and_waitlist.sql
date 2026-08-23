-- Phase 1: real waitlist. See docs/backend-architecture-prompt.md section 3.

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email comparisons
create extension if not exists vector;     -- pgvector, used starting Phase 3 (personality profiles)

create table waitlist_entries (
  id                        uuid primary key default gen_random_uuid(),
  email                     citext not null unique,
  status                    text not null default 'pending_verification'
                              check (status in ('pending_verification', 'verified', 'removed')),
  verification_token_hash   text,
  token_expires_at          timestamptz,
  verified_at               timestamptz,
  rank                      int unique,
  referral_code             text unique,
  referred_by               uuid references waitlist_entries(id) on delete set null,
  utm_source                text,
  utm_campaign              text,
  ip_hash                   text,
  user_agent                text,
  created_at                timestamptz not null default now()
);

create index waitlist_entries_status_idx on waitlist_entries (status);
create index waitlist_entries_rank_idx on waitlist_entries (rank);

-- Sequential rank assignment on verification. A single-row counter table with
-- row-level locking (see repository.ts's `select ... for update`) keeps rank
-- assignment race-free under concurrent verifications without relying on a
-- Postgres SEQUENCE (which would let ranks leak past `removed` rows and skip
-- numbers on rollback).
create table waitlist_rank_counter (
  id           boolean primary key default true check (id),
  next_rank    int not null default 1
);
insert into waitlist_rank_counter (id, next_rank) values (true, 1);
