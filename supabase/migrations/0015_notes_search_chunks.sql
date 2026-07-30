-- Search moves into Postgres.
--
-- `indexd` used to own search: a Go sidecar that scanned vault/*.html, split
-- each lesson into heading-sized chunks and served SQLite FTS5. With the app
-- writing straight to Supabase there is no local vault to scan and no sidecar
-- to run, so the same index becomes a table here and the same queries become
-- two functions.
--
-- Chunk granularity is unchanged and deliberate: every <h2>/<h3> opens a chunk,
-- content before the first heading lands in "Overview". Fixed token windows cut
-- explanations mid-thought; heading boundaries are how the lessons are taught.
-- The splitting itself stays in the app (lib/search/chunker.ts) — it reads the
-- lesson HTML contract, which is a content concern, not a database one.
--
-- 'simple' rather than a language config, matching notes_folders.search_tsv:
-- lesson titles are mixed-language technical terms and stemming would hurt.

begin;

-- --- notes_doc_chunks ---------------------------------------------------------

create table if not exists public.notes_doc_chunks (
  id           bigint generated always as identity primary key,
  document_id  uuid    not null references public.notes_documents(id) on delete cascade,
  -- Denormalised from the document so RLS and folder filtering need no join.
  -- Kept in step by the app, which rewrites a document's whole chunk set in one
  -- transaction on every save; a chunk never outlives its document (cascade).
  folder_id    uuid    not null references public.notes_folders(id)   on delete cascade,
  idx          integer not null,
  -- The notes_documents.version this chunk set was built from. A document
  -- whose version has moved on (edited elsewhere, pulled from another device,
  -- or never chunked at all) is what the reindex pass looks for — without it
  -- the only way to know an index is stale would be to re-chunk everything.
  doc_version  integer not null default 0,
  topic        text    not null default '',
  heading      text    not null default '',
  -- 0-based occurrence of this heading text within the document. Headings like
  -- "How it Works" repeat once per concept, so the viewer needs "the Nth one"
  -- to scroll a search hit into view.
  heading_index integer not null default 0,
  summary      text    not null default '',
  keywords     text    not null default '',
  body         text    not null default '',
  html         text    not null default '',
  search_tsv   tsvector generated always as (
    to_tsvector('simple',
      coalesce(heading, '') || ' ' ||
      coalesce(topic, '') || ' ' ||
      coalesce(keywords, '') || ' ' ||
      coalesce(body, ''))
  ) stored
);

create unique index if not exists notes_doc_chunks_doc_idx_key
  on public.notes_doc_chunks (document_id, idx);

create index if not exists notes_doc_chunks_folder_idx
  on public.notes_doc_chunks (folder_id);

create index if not exists notes_doc_chunks_search_idx
  on public.notes_doc_chunks using gin (search_tsv);

-- --- RLS: chunks are the document's content, so they inherit its folder ------

alter table public.notes_doc_chunks enable row level security;

drop policy if exists notes_doc_chunks_select on public.notes_doc_chunks;
create policy notes_doc_chunks_select on public.notes_doc_chunks
  for select to authenticated
  using (public.notes_can_read_folder(folder_id));

drop policy if exists notes_doc_chunks_insert on public.notes_doc_chunks;
create policy notes_doc_chunks_insert on public.notes_doc_chunks
  for insert to authenticated
  with check (public.notes_can_write_folder(folder_id));

drop policy if exists notes_doc_chunks_update on public.notes_doc_chunks;
create policy notes_doc_chunks_update on public.notes_doc_chunks
  for update to authenticated
  using (public.notes_can_write_folder(folder_id))
  with check (public.notes_can_write_folder(folder_id));

-- Chunks are replaced wholesale on every save, so unlike documents they are
-- hard-deleted: there is no cross-device tombstone to propagate, and a stale
-- chunk would keep answering searches for text the lesson no longer contains.
drop policy if exists notes_doc_chunks_delete on public.notes_doc_chunks;
create policy notes_doc_chunks_delete on public.notes_doc_chunks
  for delete to authenticated
  using (public.notes_can_write_folder(folder_id));

revoke all on public.notes_doc_chunks from public, anon;
grant select, insert, update, delete on public.notes_doc_chunks to authenticated;

-- --- search -------------------------------------------------------------------

-- SECURITY INVOKER (the default) on purpose: these run as the caller, so the
-- SELECT policies above are what decide which chunks may be searched. A
-- definer function would have to re-implement that check and could get it
-- wrong. Ranking is why this is a function at all — PostgREST cannot order by
-- ts_rank of an expression.
--
-- websearch_to_tsquery ANDs bare words, matching indexd's deliberately strict
-- FTS5 behaviour: with OR, one shared filler word ("how", "to") drags in dozens
-- of unrelated chunks as soon as a query grows past two words.
create or replace function public.notes_search_chunks(
  p_q      text,
  p_folder text    default null,
  p_kind   text    default null,
  p_limit  integer default 10
)
returns table (
  folder        text,
  id            text,
  kind          text,
  title         text,
  topic         text,
  heading       text,
  summary       text,
  keywords      text,
  seq           integer,
  heading_index integer,
  score         real,
  html          text
)
language sql
stable
set search_path = public, pg_temp
as $$
  -- Every reference below is qualified, and the ordering happens outside the
  -- select list: a RETURNS TABLE column name is also a visible identifier
  -- inside a SQL-language body, so a bare `score` or `id` would be ambiguous.
  select h.folder, h.id, h.kind, h.title, h.topic, h.heading, h.summary,
         h.keywords, h.seq, h.heading_index, h.score, h.html
    from (
      select f.slug          as folder,
             d.doc_key       as id,
             d.kind          as kind,
             d.title         as title,
             c.topic         as topic,
             c.heading       as heading,
             c.summary       as summary,
             c.keywords      as keywords,
             d.seq           as seq,
             c.heading_index as heading_index,
             ts_rank(c.search_tsv, q.tsq) as score,
             c.html          as html,
             c.idx           as idx
        from public.notes_doc_chunks c
        cross join (select websearch_to_tsquery('simple', coalesce(p_q, '')) as tsq) q
        join public.notes_documents d on d.id = c.document_id
        join public.notes_folders   f on f.id = c.folder_id
       where q.tsq <> ''::tsquery
         and c.search_tsv @@ q.tsq
         and d.deleted = false
         and f.deleted = false
         and (p_folder is null or f.slug = p_folder)
         and (p_kind   is null or d.kind = p_kind)
    ) h
   order by h.score desc, h.seq, h.idx
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

-- --- related ------------------------------------------------------------------

-- "What else is made of the same terms": the source document's own keywords
-- become the query, and every other document that scores on them comes back
-- best-first. Same approach indexd took, minus its bm25 rank inversion —
-- ts_rank is already higher-is-better.
create or replace function public.notes_related_docs(
  p_folder text,
  p_id     text,
  p_kind   text    default 'lesson',
  p_limit  integer default 5
)
returns table (
  folder text,
  id     text,
  kind   text,
  title  text,
  score  real
)
language sql
stable
set search_path = public, pg_temp
as $$
  -- Same qualification discipline as notes_search_chunks above.
  with self as (
    select d.id as document_id,
           string_agg(nullif(c.keywords, ''), ' ') as kw
      from public.notes_documents d
      join public.notes_folders   f on f.id = d.folder_id
      left join public.notes_doc_chunks c on c.document_id = d.id
     where f.slug = p_folder
       and d.doc_key = p_id
       and d.kind = coalesce(p_kind, 'lesson')
       and d.deleted = false
       and f.deleted = false
     group by d.id
     limit 1
  ),
  q as (
    select self.document_id as self_id,
           websearch_to_tsquery('simple', coalesce(self.kw, '')) as tsq
      from self
  )
  select h.folder, h.id, h.kind, h.title, h.score
    from (
      select f.slug    as folder,
             d.doc_key as id,
             d.kind    as kind,
             d.title   as title,
             max(ts_rank(c.search_tsv, q.tsq)) as score
        from public.notes_doc_chunks c
        cross join q
        join public.notes_documents d on d.id = c.document_id
        join public.notes_folders   f on f.id = c.folder_id
       where q.tsq <> ''::tsquery
         and c.search_tsv @@ q.tsq
         and d.id <> q.self_id
         and d.deleted = false
         and f.deleted = false
       group by f.slug, d.doc_key, d.kind, d.title
    ) h
   order by h.score desc
   limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

revoke execute on function
  public.notes_search_chunks(text, text, text, integer),
  public.notes_related_docs(text, text, text, integer)
from public, anon;

grant execute on function
  public.notes_search_chunks(text, text, text, integer),
  public.notes_related_docs(text, text, text, integer)
to authenticated;

commit;
