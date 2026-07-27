-- Files are members-only; folders are public by default.
--
-- Until now a folder with visibility = 'public' exposed its *documents* to any
-- signed-in user, because notes_documents' SELECT policy called
-- notes_can_read_folder(), which is true for owner OR member OR public. The
-- model changes: a folder can be publicly visible while its files never are.
--
--   folder visibility  -> who can see the folder exists, and its metadata
--   membership         -> who can read the files inside it
--
-- These are now genuinely independent. "Public" stops meaning "readable" and
-- starts meaning only "listed", which is what makes a public-by-default folder
-- safe: discovering a folder tells you nothing about its contents.
--
-- Writing is unchanged and stays role-based: joining a folder (including by
-- tag) makes you a viewer, and viewers cannot edit. Editor is reachable only
-- by an explicit invitation or role change from a manager.

begin;

-- --- files are members-only ---------------------------------------------------

-- Membership, deliberately NOT notes_can_read_folder(): that predicate admits
-- public folders and is still the right answer for folder-level metadata
-- (tags, member lists). Documents need the stricter test, so it gets its own
-- named predicate rather than a subquery inlined into the policy.
create or replace function public.notes_is_folder_member(p_folder uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1
         from public.notes_folders f
        where f.id = p_folder
          and f.deleted = false
     )
     and public.notes_folder_role(p_folder) is not null;
$$;

revoke execute on function public.notes_is_folder_member(uuid) from public, anon;
grant execute on function public.notes_is_folder_member(uuid) to authenticated;

drop policy if exists notes_documents_select on public.notes_documents;
create policy notes_documents_select on public.notes_documents
  for select to authenticated
  using (public.notes_is_folder_member(folder_id));

-- --- folders are public by default --------------------------------------------

-- New folders only. Existing rows keep whatever visibility their owner has
-- already chosen — a migration must not publish something retroactively, the
-- same rule 0001 followed when it introduced these columns.
alter table public.notes_folders
  alter column visibility set default 'public';

commit;
