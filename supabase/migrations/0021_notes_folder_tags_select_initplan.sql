-- Same fix as 0005_notes_collab_rls_initplan: a bare auth.uid() inside a
-- policy re-evaluates per row; (select auth.uid()) hoists it into an
-- InitPlan computed once. Flagged by the performance advisor immediately
-- after 0020 added this policy's bare auth.uid() inside the "holds this tag"
-- exists clause. Fixed forward rather than editing 0020 -- migrations are
-- append-only.
drop policy if exists notes_folder_tags_select on public.notes_folder_tags;
create policy notes_folder_tags_select on public.notes_folder_tags
  for select
  using (
    exists (
      select 1 from public.notes_folders f
       where f.id = notes_folder_tags.folder_id
         and f.deleted = false
         and notes_can_read_folder(f.id)
    )
    and (
      notes_can_manage_folder(notes_folder_tags.folder_id)
      or exists (
        select 1 from public.notes_user_tags ut
         where ut.tag_id = notes_folder_tags.tag_id
           and ut.user_id = (select auth.uid())
      )
    )
  );
