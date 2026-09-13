-- The feed shows each lesson's Overview, like a post body.
--
-- Every lesson carries an `<h2>Overview</h2>` section by contract
-- (docs/html-output-contract.md). The feed returns that section's HTML — the
-- text between the Overview heading and the next <h2> — capped at 4000 chars,
-- so a card can show the lesson's own summary without shipping the whole
-- document. Quizzes and any lesson without the section get null. It is cut
-- from a row the caller can already read (members only), so it reveals
-- nothing new. The client renders only paragraph-level formatting from it.

begin;

drop function if exists public.notes_feed(timestamptz, integer);

create function public.notes_feed(
  p_before timestamptz default null, p_limit integer default 20)
returns table (
  item_kind text, at timestamptz,
  doc_kind text, doc_key text, doc_title text, doc_overview text,
  folder_id uuid, folder_slug text, folder_name text, folder_description text,
  owner_username text, owner_avatar text)
language sql stable security definer set search_path = public, pg_temp
as $$
  with lim as (
    select greatest(1, least(coalesce(p_limit, 20), 50)) as n
  ),
  docs as (
    select 'doc'::text, d.created_at, d.kind, d.doc_key, d.title,
           left((regexp_match(d.html, '<h2[^>]*>\s*Overview\s*</h2>(.*?)(<h2|$)', 'i'))[1], 4000),
           f.id, f.slug, f.name, null::text,
           p.username, p.avatar_url
      from public.notes_folder_members m
      join public.notes_documents d on d.folder_id = m.folder_id and d.deleted = false
      join public.notes_folders f on f.id = m.folder_id and f.deleted = false
      join public.profiles p on p.id = f.owner_id
     where m.user_id = auth.uid()
       and (p_before is null or d.created_at < p_before)
     order by d.created_at desc
     limit (select n from lim)
  ),
  folders as (
    select 'folder'::text, f.created_at, null::text, null::text, null::text, null::text,
           f.id, f.slug, f.name, f.description,
           p.username, p.avatar_url
      from public.notes_follows fo
      join public.notes_folders f
        on f.owner_id = fo.followee_id and f.deleted = false and f.visibility = 'public'
      join public.profiles p on p.id = f.owner_id
     where fo.follower_id = auth.uid()
       and fo.status = 'accepted'
       and (p_before is null or f.created_at < p_before)
     order by f.created_at desc
     limit (select n from lim)
  )
  select * from (select * from docs union all select * from folders) x
   where auth.uid() is not null
   order by 2 desc
   limit (select n from lim);
$$;

revoke execute on function public.notes_feed(timestamptz, integer) from public, anon;
grant execute on function public.notes_feed(timestamptz, integer) to authenticated;

commit;
