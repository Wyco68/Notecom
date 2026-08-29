-- 0023_notes_documents_title_pinned.sql
-- A rename in the app (lib/vault/store.ts renameDoc) changes the database
-- title, but vault/<folder>/index.json still holds the title Claude Code
-- generated — the app writes no files. lib/vault/import.ts re-reads every
-- vault file whenever its per-process mtime cache is empty, which is every
-- desktop launch, and saveDoc saw a title that differed and wrote the
-- generated one back. The rename survived until the next start.
--
-- This flag is how a save tells the two apart: a title the user chose outranks
-- the one in the file, while html, slug and seq keep coming from the file as
-- before.
alter table public.notes_documents
  add column if not exists title_pinned boolean not null default false;
