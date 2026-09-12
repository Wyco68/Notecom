-- A tag anyone signed in may claim for themselves, and the demo courses it
-- opens.
--
-- Every other tag is a claim someone else makes about you: follow them, they
-- offer, you accept (0009). That is deliberate and stays the rule — it is what
-- makes a tag worth something as an access grant. But it needs three
-- round trips between two people before a brand-new account can read anything,
-- and a new account has generated nothing of its own, so the app's first screen
-- is empty until someone else acts. For a demo that is the whole first
-- impression.
--
-- `notes_tags.self_serve` is the one exception, and it is a property of the
-- tag rather than of the claimer: a tag marked self-serve is one its author has
-- decided to publish to everyone, so `notes_claim_tag()` needs no follow edge
-- and no grant. A caller cannot make a tag claimable by naming it — the column
-- is only writable by the tag's author through a migration or an ordinary
-- update under RLS, never by the RPC.
--
-- Two consequences worth stating, both intended:
--
--   * No `notes_tag_grants` row is written, so nobody can revoke a self-serve
--     tag from a holder — there is no granter to stop vouching. Dropping it
--     stays the holder's own right (`notes_user_tags` DELETE policy), which is
--     the only revocation path that makes sense for a tag published to all.
--   * Access still arrives the same way as any other tag: implied, read-only
--     membership via `notes_is_folder_member()`, revoked everywhere the moment
--     the holder drops the tag.

begin;

alter table public.notes_tags
  add column if not exists self_serve boolean not null default false;

comment on column public.notes_tags.self_serve is
  'true when any signed-in user may claim this tag through notes_claim_tag(). '
  'Defaults false: a tag is normally a claim someone else makes about you.';

-- Claim a published tag for yourself.
create or replace function public.notes_claim_tag(p_slug text)
returns text
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_tag   bigint;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- `self_serve` is the entire authorization check, and it is read from the
  -- tag, never taken from the caller. A tag that is not published reads as
  -- absent rather than as refused, so this cannot be used to probe which tags
  -- exist.
  select id, label into v_tag, v_label
    from public.notes_tags
   where slug = lower(trim(p_slug))
     and self_serve;
  if v_tag is null then
    raise exception 'no such tag' using errcode = 'P0002';
  end if;

  -- Idempotent on purpose: claiming a tag already held is success, so a
  -- double-clicked button needs no second code path.
  insert into public.notes_user_tags (user_id, tag_id)
  values (auth.uid(), v_tag)
  on conflict do nothing;

  return v_label;
end;
$$;

revoke execute on function public.notes_claim_tag(text) from public, anon;
grant execute on function public.notes_claim_tag(text) to authenticated;

-- The demo tag itself: data, not schema, so it is seeded by lookup and skipped
-- on a database that has no such account or folders (a fresh local stack, a
-- fork). Nothing below hardcodes an id.
do $$
declare
  v_owner uuid;
  v_tag   bigint;
  v_named int;
begin
  select id into v_owner
    from public.profiles
   where lower(username) = 'wyco';

  if v_owner is null then
    raise notice 'no profile named wyco here — skipping the demo tag seed';
    return;
  end if;

  insert into public.notes_tags (slug, label, created_by, self_serve)
  values ('demo', 'Demo', v_owner, true)
  on conflict (slug) do update set self_serve = true
  returning id into v_tag;

  -- grants_join is true because every folder-tag association grants joining
  -- now; the column survives only as the redundancy
  -- notes_is_folder_member() still reads (see docs/collaboration.md).
  insert into public.notes_folder_tags (folder_id, tag_id, grants_join)
  select f.id, v_tag, true
    from public.notes_folders f
   where f.owner_id = v_owner
     and f.deleted = false
     and f.slug in ('General-Education', 'Wireless-Network', 'Operating-System')
  on conflict (folder_id, tag_id) do update set grants_join = true;

  get diagnostics v_named = row_count;
  raise notice 'demo tag now carried by % folder(s)', v_named;
end $$;

commit;
