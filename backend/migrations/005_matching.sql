-- Phase 4: matching engine. See docs/backend-architecture-prompt.md section 6.

create table match_candidates (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  candidate_id   uuid not null references users(id) on delete cascade,
  score          numeric not null,
  status         text not null default 'pending'
                   check (status in ('pending', 'interested', 'passed', 'expired')),
  presented_at   timestamptz,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, candidate_id),
  check (user_id <> candidate_id)
);

create index match_candidates_user_status_idx on match_candidates (user_id, status);
create index match_candidates_candidate_idx on match_candidates (candidate_id);

-- A mutual match exists once both directional rows are 'interested'. Populated
-- by the matching worker when it detects that condition (see
-- src/modules/matching/service.ts#checkForMutualMatch).
create table matches (
  id                uuid primary key default gen_random_uuid(),
  user_a_id         uuid not null references users(id) on delete cascade,
  user_b_id         uuid not null references users(id) on delete cascade,
  matched_at        timestamptz not null default now(),
  unique (user_a_id, user_b_id),
  check (user_a_id < user_b_id) -- canonical ordering avoids storing both directions
);
