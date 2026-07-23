-- Collaborative folders: close the anon RPC surface.
--
-- PostgREST exposes every executable function at /rest/v1/rpc/<name>, and
-- EXECUTE defaults to PUBLIC. 0002 revoked the action RPCs from anon but left
-- the predicates and the membership trigger function reachable. The predicates
-- return null/false for an anonymous caller so nothing leaked, but a
-- SECURITY DEFINER function should never be callable by a role that has no
-- business calling it — the security advisor flags exactly this.
--
-- The trigger function is revoked from every role: it is only ever invoked by
-- the trigger, which runs as the definer regardless of grants.

begin;

revoke execute on function
  public.notes_folder_role(uuid),
  public.notes_can_read_folder(uuid),
  public.notes_can_write_folder(uuid),
  public.notes_can_manage_folder(uuid)
from public, anon;

grant execute on function
  public.notes_folder_role(uuid),
  public.notes_can_read_folder(uuid),
  public.notes_can_write_folder(uuid),
  public.notes_can_manage_folder(uuid)
to authenticated;

revoke execute on function public.notes_sync_owner_membership()
from public, anon, authenticated;

commit;
