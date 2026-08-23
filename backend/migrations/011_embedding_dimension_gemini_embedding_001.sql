-- The originally targeted embedding model, text-embedding-004, is retired.
-- Its replacement, gemini-embedding-001, natively outputs 3072 dimensions —
-- but pgvector's ivfflat index caps at 2000 dimensions, and the installed
-- SDK version doesn't expose the server-side outputDimensionality
-- truncation parameter. Since gemini-embedding-001 is Matryoshka-trained
-- specifically so truncating to a prefix preserves embedding quality, the
-- app truncates client-side to 768 dims instead (see
-- src/providers/ai/gemini.ts#embedProfile) and the schema stays vector(768)
-- as originally defined in migrations/004. This migration only clears the
-- one stub-sourced row generated before the model/embedding fix landed.

truncate table personality_profiles;
