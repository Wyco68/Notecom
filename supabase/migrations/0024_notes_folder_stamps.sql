-- 0024_notes_folder_stamps.sql
-- What the tree's focus check was missing.
--
-- GET /api/tree returns folder names only, so the automatic re-check on window
-- focus could see a folder appear or disappear but never a change *inside* one:
-- a lesson renamed, edited or deleted on another device stayed on screen under
-- its old name until someone pressed refresh. Re-fetching every open folder's
-- documents on every focus was the alternative, and it pays for the documents
-- on every alt-tab to learn that nothing moved.
--
-- One stamp per folder answers "did anything in here change" in the request the
-- client already makes. max(updated_at) covers all three cases, because a
-- rename, a save and a delete all set it — deleted rows included, or a delete
-- would look like no change at all.
--
-- security invoker (the default, stated for the reader): the aggregate must see
-- exactly the folders and documents RLS grants the caller, not the definer's.
create or replace function public.notes_folder_stamps()
returns table (folder_slug text, stamp timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select f.slug, max(d.updated_at)
    from public.notes_folders f
    left join public.notes_documents d on d.folder_id = f.id
   where f.deleted = false
   group by f.slug
$$;

revoke execute on function public.notes_folder_stamps() from public, anon;
grant execute on function public.notes_folder_stamps() to authenticated;
