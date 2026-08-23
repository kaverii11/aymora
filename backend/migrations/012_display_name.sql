-- The app has no way to show who a match/chat partner *is* without this —
-- email/phone are private, and there was no public-facing name field at all.
-- Nullable: not every existing row has one (backfilled at signup going forward).

alter table users add column display_name text;
