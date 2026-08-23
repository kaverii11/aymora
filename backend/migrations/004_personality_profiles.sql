-- Phase 3: AI personality profiling. See docs/backend-architecture-prompt.md section 5.
-- Embedding dimension is 768 to match Gemini's text-embedding-004 model
-- (the project runs on the Gemini free tier, not Claude/Voyage as in the
-- original architecture doc — see src/providers/ai/gemini.ts).

create table personality_profiles (
  user_id         uuid primary key references users(id) on delete cascade,
  profile         jsonb not null,        -- structured dimensions from the LLM
  embedding       vector(768),
  model_version   text not null,         -- model + prompt version that produced this
  source          text not null default 'gemini' check (source in ('gemini', 'stub')),
  generated_at    timestamptz not null default now()
);

create index personality_profiles_embedding_idx
  on personality_profiles using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
