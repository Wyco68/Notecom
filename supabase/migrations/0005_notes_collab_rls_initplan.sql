-- Collaborative folders: hoist auth.uid() out of per-row evaluation.
--
-- A bare auth.uid() inside a policy is re-evaluated for every candidate row.
-- Wrapping it as (select auth.uid()) turns it into an InitPlan that runs once
-- per query. Same semantics, and it matters here because these policies sit on
-- the read path of every folder and document listing.
--
-- Policies are recreated rather than altered — Postgres has no ALTER POLICY
-- that rewrites an expression in place without restating it anyway.

begin;

drop policy if exists notes_folders_insert on public.notes_folders;
create policy notes_folders_insert on public.notes_folders
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists notes_folders_update on public.notes_folders;
create policy notes_folders_update on public.notes_folders
  for update to authenticated
  using (public.notes_can_manage_folder(id))
  with check (public.notes_can_manage_folder(id) and owner_id = (select auth.uid()));

drop policy if exists notes_folder_members_leave on public.notes_folder_members;
create policy notes_folder_members_leave on public.notes_folder_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and not exists (
      select 1 from public.notes_folders f
       where f.id = folder_id and f.owner_id = (select auth.uid())
    )
  );

drop policy if exists notes_tags_insert on public.notes_tags;
create policy notes_tags_insert on public.notes_tags
  for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists notes_folder_invitations_select on public.notes_folder_invitations;
create policy notes_folder_invitations_select on public.notes_folder_invitations
  for select to authenticated
  using (
    invitee_id = (select auth.uid())
    or inviter_id = (select auth.uid())
    or public.notes_can_manage_folder(folder_id)
  );

drop policy if exists notes_folder_join_requests_select on public.notes_folder_join_requests;
create policy notes_folder_join_requests_select on public.notes_folder_join_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.notes_can_manage_folder(folder_id));

drop policy if exists notes_folder_join_requests_withdraw on public.notes_folder_join_requests;
create policy notes_folder_join_requests_withdraw on public.notes_folder_join_requests
  for delete to authenticated
  using (user_id = (select auth.uid()) and status = 'pending');

create index if not exists notes_folder_members_role_idx
  on public.notes_folder_members (role);

commit;
