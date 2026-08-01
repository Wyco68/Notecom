-- Following becomes request/accept, mirroring notes_folder_invitations.
--
-- Before: notes_follows was a one-sided edge, written directly by follow()
-- with no approval step. That let anyone attach themselves to a stranger's
-- follower list -- the exact set notes_grant_tag/notes_invite_member trust to
-- decide who may claim a tag on someone or invite them.
--
-- After: a follow row starts 'pending' and only becomes 'accepted' when the
-- followee answers, via notes_respond_follow -- the same pending -> accepted
-- shape notes_folder_invitations already uses, answered by
-- notes_respond_invitation. notes_follows_me() (the gate on tagging and
-- inviting) now requires 'accepted'.
--
-- Existing rows predate the approval step and already granted the access
-- notes_follows_me was built to gate -- they backfill to 'accepted' rather
-- than silently losing that access.

begin;

-- --- schema: nullable -> backfill -> not null, the standard sequence for a
-- populated table -------------------------------------------------------------

alter table public.notes_follows add column if not exists status text;

update public.notes_follows set status = 'accepted' where status is null;

alter table public.notes_follows alter column status set default 'pending';
alter table public.notes_follows alter column status set not null;

alter table public.notes_follows
  drop constraint if exists notes_follows_status_check;
alter table public.notes_follows
  add constraint notes_follows_status_check check (status in ('pending', 'accepted'));

-- --- notes_follows_me now requires acceptance ---------------------------------

create or replace function public.notes_follows_me(p_user uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.notes_follows
     where follower_id = p_user and followee_id = auth.uid() and status = 'accepted'
  );
$$;

-- --- a follower may only ever write their own row as pending ------------------
-- Unchanged: notes_follows_select already lets a followee see rows addressed
-- to them regardless of status (follower_id = auth.uid() or followee_id =
-- auth.uid()), and notes_follows_delete already lets either side remove the
-- edge -- unfollow, or a followee declining/removing a follower outright.

drop policy if exists notes_follows_insert on public.notes_follows;
create policy notes_follows_insert on public.notes_follows
  for insert to authenticated
  with check (follower_id = (select auth.uid()) and status = 'pending');

-- --- notes_respond_follow: the followee answers a pending request ------------
-- Mirrors notes_respond_invitation. Accept flips status; decline deletes the
-- row outright (there is no 'declined' status to sit in) so a later re-follow
-- attempt starts clean instead of colliding with a dead row.

create or replace function public.notes_respond_follow(
  p_follower uuid,
  p_accept   boolean
)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_row public.notes_follows;
begin
  select * into v_row
    from public.notes_follows
   where follower_id = p_follower
     and followee_id = auth.uid()
     and status = 'pending'
   for update;

  if v_row.follower_id is null then
    raise exception 'no pending follow request' using errcode = 'P0002';
  end if;

  if not p_accept then
    delete from public.notes_follows
     where follower_id = p_follower and followee_id = auth.uid();
    return 'declined';
  end if;

  update public.notes_follows
     set status = 'accepted'
   where follower_id = p_follower and followee_id = auth.uid();

  return 'accepted';
end;
$$;

revoke execute on function public.notes_respond_follow(uuid, boolean) from public, anon;
grant execute on function public.notes_respond_follow(uuid, boolean) to authenticated;

commit;
