-- New rule: a folder's tags are visible only to someone who holds them,
-- except the folder's own manager, who always sees every tag on their own
-- folder (FolderManagePanel's tag list is how they remove one -- hiding a
-- tag from its own manager would make it unmanageable).
--
-- This table is read directly (lib/collab/folders.ts's listFolderTags(), a
-- plain `.from("notes_folder_tags").select(...)`, not a SECURITY DEFINER
-- RPC), so tightening the RLS SELECT policy is sufficient on its own for
-- that call site. notes_search_folders()/notes_my_folders() are SECURITY
-- DEFINER and so do not inherit this policy inside their own lateral joins
-- -- those were already given the equivalent filter directly in the
-- previous migration (notes_tag_implied_folder_access).
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
           and ut.user_id = auth.uid()
      )
    )
  );
