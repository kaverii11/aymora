-- Phase 2: questionnaire. See docs/backend-architecture-prompt.md section 4.3.

create table questionnaire_versions (
  id          uuid primary key default gen_random_uuid(),
  version     int not null unique,
  schema      jsonb not null,   -- [{ id, type: 'likert'|'free_text'|'multi_select', prompt, options? }]
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Only one active version at a time.
create unique index questionnaire_versions_single_active_idx
  on questionnaire_versions (is_active)
  where is_active;

create table questionnaire_responses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  version_id    uuid not null references questionnaire_versions(id),
  answers       jsonb not null default '{}',
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, version_id)
);

create index questionnaire_responses_user_idx on questionnaire_responses (user_id);
create index questionnaire_responses_completed_idx on questionnaire_responses (completed_at)
  where completed_at is not null;
