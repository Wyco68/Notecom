-- Structured data a document carries beside its HTML. Used by cheatsheets
-- (kind = 'sheet'): the chapter range and page limit they were made for, what
-- the source review found, and the edit conversation. Lessons and quizzes
-- leave it null.
--
-- No policy change: notes_documents' policies are per folder and kind-blind,
-- so a sheet is readable and writable exactly as its folder's lessons are.
alter table public.notes_documents add column if not exists meta jsonb;
