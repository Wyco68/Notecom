-- 0022_notes_documents_unique_doc_key.sql
-- (folder_id, kind, doc_key) is a document's identity — lib/vault/store.ts
-- looks one up by exactly that triple — but nothing enforced it. saveDoc
-- read-then-inserted, so two imports overlapping (/api/tree runs one per tree
-- load) both saw "no row" and both inserted: five byte-identical duplicate
-- lessons in one folder, ~100ms apart. The index is what makes saveDoc's
-- upsert resolve a concurrent insert into an update instead of a second row.

-- Rows created before the constraint existed. Keeps the furthest-along copy of
-- each key: highest version, then most recently updated, with id as a final
-- tie-break so the comparison is total and exactly one row survives. Chunks of
-- the losing rows go with them via notes_doc_chunks_document_id_fkey (cascade).
delete from public.notes_documents d
 using public.notes_documents keep
 where d.folder_id = keep.folder_id
   and d.kind = keep.kind
   and d.doc_key = keep.doc_key
   and (d.version, d.updated_at, d.created_at, d.id)
     < (keep.version, keep.updated_at, keep.created_at, keep.id);

-- Unique over every row, not just the live ones: a delete is a tombstone
-- (deleted = true) that saveDoc revives in place, so a deleted row still owns
-- its key.
create unique index if not exists notes_documents_doc_key_key
  on public.notes_documents (folder_id, kind, doc_key);

-- Redundant now: 0013's partial index covers the same three columns in the
-- same order, and the unique index above serves that lookup's equality
-- predicates without the second copy to maintain on every write.
drop index if exists public.notes_documents_lookup_idx;
