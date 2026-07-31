-- The app has always created folders with visibility = 'private' explicitly
-- (lib/vault/store.ts createFolder) — the column's own default has been
-- 'public' since 0009 only because a different feature needed it, and nothing
-- in the app relies on it. That gap matters because the column default is what
-- a row gets when anything *other* than createFolder inserts one: a future
-- code path, a manual fix in the SQL editor, a migration that seeds a row.
-- Matching the default to what the product actually does removes that one
-- silent way to end up with an unintentionally public folder.
--
-- Every existing folder is already private (verified before writing this), so
-- there is no data to migrate — same as 0012's rule, this only ever narrows
-- what a *future* row can default to, never republishes anything already
-- chosen.

begin;

alter table public.notes_folders
  alter column visibility set default 'private';

commit;
