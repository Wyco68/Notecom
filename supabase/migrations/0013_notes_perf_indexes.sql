-- 0013_notes_perf_indexes.sql
-- Two predicates confirmed unindexed by `explain (analyze, buffers)` on
-- tables that grow with normal use (documents, tag grants).

-- notes_tag_grants: granter_id is filtered by the RLS select policy
-- (0009_notes_follows_tag_grants.sql) and by notes_revoke_tag /
-- notes_granted_tags (0011_notes_revoke_tag.sql). Mirrors the shape of the
-- existing notes_tag_grants_grantee_idx.
create index if not exists notes_tag_grants_granter_idx
  on public.notes_tag_grants (granter_id, status);

-- notes_documents: the hosted-reader lookup (lib/vault/supabase.ts,
-- loadDocFromSupabase) filters folder_id in (...), kind, doc_key, deleted --
-- currently a Seq Scan. Composite matches the query's equality predicates in
-- order; the partial predicate matches the constant `deleted = false` filter.
create index if not exists notes_documents_lookup_idx
  on public.notes_documents (folder_id, kind, doc_key)
  where deleted = false;
