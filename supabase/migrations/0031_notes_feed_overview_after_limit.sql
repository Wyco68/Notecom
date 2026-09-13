-- Cut the feed's Overview only for the rows actually returned.
--
-- 0030 computed the overview inside the documents branch, so Postgres
-- evaluated it for every document in every folder the caller belongs to and
-- only then sorted and kept 20 — measured at ~175 ms of a 205 ms query for 53
-- documents, growing with the size of the reader's folders rather than with
-- the page. Its regex was also wrong: a non-greedy group followed by an
-- alternation takes the whole RE's greediness in Postgres ARE, so it captured
-- to the end of the document (~24 KB) instead of stopping at the next <h2>.
--
-- Now the page is chosen first (ids only), and the overview is cut from those
-- ≤50 rows with plain string functions: the contract fixes the heading as
-- exactly `<h2>Overview</h2>` (docs/html-output-contract.md), so `strpos` finds
-- it and `split_part(..., '<h2', 1)` stops at the next section. Same return
-- shape as 0030, so callers and grants are untouched.

begin;

create or replace function public.notes_feed(
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
    select d.id as doc_id, 'doc'::text as item_kind, d.created_at as at,
           d.kind as doc_kind, d.doc_key, d.title as doc_title,
           f.id as folder_id, f.slug as folder_slug, f.name as folder_name,
           null::text as folder_description,
           p.username as owner_username, p.avatar_url as owner_avatar
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
    select null::uuid, 'folder'::text, f.created_at,
           null::text, null::text, null::text,
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
  ),
  page as (
    select * from (select * from docs union all select * from folders) u
     where auth.uid() is not null
     order by at desc
     limit (select n from lim)
  )
  select pg.item_kind, pg.at, pg.doc_kind, pg.doc_key, pg.doc_title,
         case when pg.doc_id is null then null else (
           select case when x.s = 0 then null
                       else left(split_part(substr(d2.html, x.s + 17), '<h2', 1), 4000)
                  end
             from public.notes_documents d2
             cross join lateral (select strpos(d2.html, '<h2>Overview</h2>') as s) x
            where d2.id = pg.doc_id
         ) end,
         pg.folder_id, pg.folder_slug, pg.folder_name, pg.folder_description,
         pg.owner_username, pg.owner_avatar
    from page pg
   order by pg.at desc;
$$;

commit;
