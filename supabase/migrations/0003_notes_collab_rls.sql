-- Collaborative folders: Row Level Security.
--
-- Deny by default. Every policy is a single call to a predicate from 0002 —
-- see the note there on why those are SECURITY DEFINER (policy recursion).
-- `anon` is granted nothing on any of these tables.
--
-- Two tables deliberately have no INSERT/UPDATE policy: membership and join
-- requests are written only by the RPCs in 0002, which re-check authorization
-- themselves. The self-service exceptions are leaving a folder and withdrawing
-- one's own request.

begin;

-- --- notes_folders ------------------------------------------------------------

alter table public.notes_folders enable row level security;

-- Members see their folders including tombstones (deleted = true), because
-- `stored` needs the tombstone to replicate the delete locally. Non-members see
-- live folders that are public or discoverable — metadata only; the documents
-- policy below is what actually guards content.
drop policy if exists notes_folders_select on public.notes_folders;
create policy notes_folders_select on public.notes_folders
  for select to authenticated
  using (
    public.notes_folder_role(id) is not null
    or (deleted = false and (visibility = 'public' or discoverable = true))
  );

drop policy if exists notes_folders_insert on public.notes_folders;
create policy notes_folders_insert on public.notes_folders
  for insert to authenticated
  with check (owner_id = auth.uid());

-- The WITH CHECK pins owner_id to the caller, so an UPDATE can never transfer a
-- folder to someone else. Ownership transfer is not a feature; if it becomes
-- one it belongs in an RPC, not here.
drop policy if exists notes_folders_update on public.notes_folders;
create policy notes_folders_update on public.notes_folders
  for update to authenticated
  using (public.notes_can_manage_folder(id))
  with check (public.notes_can_manage_folder(id) and owner_id = auth.uid());

drop policy if exists notes_folders_delete on public.notes_folders;
create policy notes_folders_delete on public.notes_folders
  for delete to authenticated
  using (public.notes_can_manage_folder(id));

-- --- notes_documents ----------------------------------------------------------

alter table public.notes_documents enable row level security;

drop policy if exists notes_documents_select on public.notes_documents;
create policy notes_documents_select on public.notes_documents
  for select to authenticated
  using (public.notes_can_read_folder(folder_id));

drop policy if exists notes_documents_insert on public.notes_documents;
create policy notes_documents_insert on public.notes_documents
  for insert to authenticated
  with check (public.notes_can_write_folder(folder_id));

drop policy if exists notes_documents_update on public.notes_documents;
create policy notes_documents_update on public.notes_documents
  for update to authenticated
  using (public.notes_can_write_folder(folder_id))
  with check (public.notes_can_write_folder(folder_id));

drop policy if exists notes_documents_delete on public.notes_documents;
create policy notes_documents_delete on public.notes_documents
  for delete to authenticated
  using (public.notes_can_write_folder(folder_id));

-- --- notes_folder_roles: read-only lookup ------------------------------------

drop policy if exists notes_folder_roles_select on public.notes_folder_roles;
create policy notes_folder_roles_select on public.notes_folder_roles
  for select to authenticated using (true);

-- --- notes_folder_members -----------------------------------------------------

drop policy if exists notes_folder_members_select on public.notes_folder_members;
create policy notes_folder_members_select on public.notes_folder_members
  for select to authenticated
  using (public.notes_can_read_folder(folder_id));

-- The one direct write: leaving. An owner cannot leave their own folder.
drop policy if exists notes_folder_members_leave on public.notes_folder_members;
create policy notes_folder_members_leave on public.notes_folder_members
  for delete to authenticated
  using (
    user_id = auth.uid()
    and not exists (
      select 1 from public.notes_folders f
       where f.id = folder_id and f.owner_id = auth.uid()
    )
  );

-- --- notes_tags ---------------------------------------------------------------

drop policy if exists notes_tags_select on public.notes_tags;
create policy notes_tags_select on public.notes_tags
  for select to authenticated using (true);

drop policy if exists notes_tags_insert on public.notes_tags;
create policy notes_tags_insert on public.notes_tags
  for insert to authenticated
  with check (created_by = auth.uid());

-- --- notes_folder_tags --------------------------------------------------------

drop policy if exists notes_folder_tags_select on public.notes_folder_tags;
create policy notes_folder_tags_select on public.notes_folder_tags
  for select to authenticated
  using (
    exists (
      select 1 from public.notes_folders f
       where f.id = folder_id
         and f.deleted = false
         and (f.discoverable = true or public.notes_can_read_folder(f.id))
    )
  );

drop policy if exists notes_folder_tags_insert on public.notes_folder_tags;
create policy notes_folder_tags_insert on public.notes_folder_tags
  for insert to authenticated
  with check (public.notes_can_manage_folder(folder_id));

drop policy if exists notes_folder_tags_update on public.notes_folder_tags;
create policy notes_folder_tags_update on public.notes_folder_tags
  for update to authenticated
  using (public.notes_can_manage_folder(folder_id))
  with check (public.notes_can_manage_folder(folder_id));

drop policy if exists notes_folder_tags_delete on public.notes_folder_tags;
create policy notes_folder_tags_delete on public.notes_folder_tags
  for delete to authenticated
  using (public.notes_can_manage_folder(folder_id));

-- --- notes_folder_invitations -------------------------------------------------

drop policy if exists notes_folder_invitations_select on public.notes_folder_invitations;
create policy notes_folder_invitations_select on public.notes_folder_invitations
  for select to authenticated
  using (
    invitee_id = auth.uid()
    or inviter_id = auth.uid()
    or public.notes_can_manage_folder(folder_id)
  );

-- Exists only so an owner can revoke a pending invitation; accepting and
-- declining go through notes_respond_invitation.
drop policy if exists notes_folder_invitations_revoke on public.notes_folder_invitations;
create policy notes_folder_invitations_revoke on public.notes_folder_invitations
  for update to authenticated
  using (public.notes_can_manage_folder(folder_id) and status = 'pending')
  with check (public.notes_can_manage_folder(folder_id) and status = 'revoked');

drop policy if exists notes_folder_invitations_delete on public.notes_folder_invitations;
create policy notes_folder_invitations_delete on public.notes_folder_invitations
  for delete to authenticated
  using (public.notes_can_manage_folder(folder_id));

-- --- notes_folder_join_requests -----------------------------------------------

drop policy if exists notes_folder_join_requests_select on public.notes_folder_join_requests;
create policy notes_folder_join_requests_select on public.notes_folder_join_requests
  for select to authenticated
  using (user_id = auth.uid() or public.notes_can_manage_folder(folder_id));

drop policy if exists notes_folder_join_requests_withdraw on public.notes_folder_join_requests;
create policy notes_folder_join_requests_withdraw on public.notes_folder_join_requests
  for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');

-- --- grants -------------------------------------------------------------------

revoke all on public.notes_folders, public.notes_documents,
  public.notes_folder_roles, public.notes_folder_members, public.notes_tags,
  public.notes_folder_tags, public.notes_folder_invitations,
  public.notes_folder_join_requests, public.notes_folder_access
from anon;

grant select on public.notes_folder_roles to authenticated;
grant select, insert on public.notes_tags to authenticated;
grant select, insert, update, delete on
  public.notes_folders, public.notes_documents, public.notes_folder_members,
  public.notes_folder_tags, public.notes_folder_invitations,
  public.notes_folder_join_requests
to authenticated;
grant select on public.notes_folder_access to authenticated;

commit;
