-- notes_granted_tags gains the grantee's avatar path, so a list of "tags I
-- handed out" can show a photo per person without a second round trip per
-- row. Same convention notes_search_folders already uses for owner_avatar:
-- the RPC returns the stored path, signing happens once in
-- lib/collab/avatar.ts.

begin;

drop function if exists public.notes_granted_tags();

create function public.notes_granted_tags()
returns table (username text, avatar_url text, tag_slug text, tag_label text, granted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.username, p.avatar_url, t.slug, t.label, g.responded_at
    from public.notes_tag_grants g
    join public.profiles p on p.id = g.grantee_id
    join public.notes_tags t on t.id = g.tag_id
   where g.granter_id = auth.uid()
     and g.status = 'accepted'
   order by p.username, t.slug;
$$;

revoke execute on function public.notes_granted_tags() from public, anon;
grant execute on function public.notes_granted_tags() to authenticated;

commit;
