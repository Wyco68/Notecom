-- Revoking a tag you granted.
--
-- 0009 gave notes_tag_grants a 'revoked' status but no way to reach it: a
-- granter could hand out a tag and never take it back, while the holder could
-- drop it at will. That is the wrong way round for a tag that acts as a
-- credential — the person who vouched for someone must be able to stop
-- vouching, the same way they can remove a folder member.
--
-- Revoking deletes the notes_user_tags row, so every folder that tag was
-- opening closes at once. It cannot touch a tag the caller did not grant:
-- two people may both have granted the same tag to the same user, and
-- revoking is per-grant, not per-tag.

begin;

create or replace function public.notes_revoke_tag(
  p_username text,
  p_label    text
)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_holder uuid;
  v_tag    bigint;
  v_slug   text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select id into v_holder
    from public.profiles
   where lower(username) = lower(trim(p_username));
  if v_holder is null then
    raise exception 'no such user' using errcode = 'P0002';
  end if;

  v_slug := lower(trim(p_label));
  select id into v_tag from public.notes_tags where slug = v_slug;
  if v_tag is null then
    raise exception 'no such tag' using errcode = 'P0002';
  end if;

  -- The caller must be the one who granted this tag to this person. Without
  -- this, anyone could strip anyone else's tags.
  if not exists (
    select 1 from public.notes_tag_grants
     where tag_id = v_tag
       and grantee_id = v_holder
       and granter_id = auth.uid()
       and status = 'accepted'
  ) then
    raise exception 'you did not grant that tag' using errcode = '42501';
  end if;

  update public.notes_tag_grants
     set status = 'revoked', responded_at = now()
   where tag_id = v_tag and grantee_id = v_holder
     and granter_id = auth.uid() and status = 'accepted';

  -- Only drop the held tag if nobody else is still vouching for it.
  if not exists (
    select 1 from public.notes_tag_grants
     where tag_id = v_tag and grantee_id = v_holder and status = 'accepted'
  ) then
    delete from public.notes_user_tags
     where user_id = v_holder and tag_id = v_tag;
  end if;

  return 'revoked';
end;
$$;

revoke execute on function public.notes_revoke_tag(text, text) from public, anon;
grant execute on function public.notes_revoke_tag(text, text) to authenticated;

-- The granter needs to see what they have handed out in order to take it back.
create or replace function public.notes_granted_tags()
returns table (username text, tag_slug text, tag_label text, granted_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.username, t.slug, t.label, g.responded_at
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
