---
name: collab
description: Authoring and reviewing folder collaboration, sharing, membership, roles, invitations, join requests, tags, folder search, and Supabase Row Level Security in this repo. Use whenever a task touches supabase/migrations/, lib/collab/, lib/supabase/, app/api/collab/, notes_folder_* tables, or RLS policies. Not for lesson or quiz content.
---

# Collaboration & RLS

Read [docs/collaboration.md](../../../docs/collaboration.md) first — it holds the
model, the role table, and the table-by-table rationale. This skill is the
working procedure and the checks that must pass.

## Before writing any SQL

1. `mcp__supabase__list_tables` on project `pfefqlcxnefetpyoubkd`, schema
   `public`. The BookCommunity tables (`profiles`, `reading_sessions`,
   `session_members`, `session_join_requests`) are the pattern donors — read them
   before inventing a shape.
2. `mcp__supabase__list_migrations` to see what is already applied.
3. Prefer extending `notes_folders` over adding a table. Only add a table when
   the relationship is genuinely many-to-many or has its own lifecycle.

## Writing migrations

- One file per concern in `supabase/migrations/`, named
  `NNNN_short_description.sql`. Apply with `mcp__supabase__apply_migration`.
- **Append-only.** Never edit a file that has been applied — same discipline as
  an applied migration. Fix forward with a new migration.
- Order matters: schema → functions → policies. A policy referencing a function
  that does not exist yet fails the whole migration.
- Adding a `NOT NULL` column to a populated table is three steps: add nullable,
  backfill, then `SET NOT NULL`.

## Writing policies

- Enable RLS and write policies for **all four** commands. A table with RLS on
  and no INSERT policy silently rejects every insert — that is sometimes the
  intent (`notes_folder_members`), but it must be intentional and commented.
- A policy body is one call to a helper predicate. If you find yourself writing a
  subquery against `notes_folder_members` inside a policy on
  `notes_folder_members`, stop — that recurses. Use
  `notes_can_read_folder()` / `notes_can_write_folder()` / `notes_can_manage_folder()`,
  which are `STABLE SECURITY DEFINER` for exactly this reason.
- `USING` governs which existing rows are visible or targetable; `WITH CHECK`
  governs what a row may become. An UPDATE policy usually needs both, and they
  are usually not the same expression — a member must not be able to UPDATE a
  folder into someone else's `owner_id`.
- Grant `anon` nothing. Ever.

## Writing SECURITY DEFINER functions

RLS is **off** inside the body, so the function is the security boundary:

- First statements establish `auth.uid()` and check authorization explicitly.
  Return or `RAISE EXCEPTION` before touching a row.
- Pin the search path: `SET search_path = public, pg_temp`.
- `STABLE` for predicates, `VOLATILE` for actions.
- Never accept a `user_id` argument that the function then trusts. Derive the
  caller from `auth.uid()`; take a *target* user only in manage-level RPCs, after
  confirming the caller can manage that folder.

## The RLS proof (required before any collaboration change is done)

`npx tsc --noEmit` and `go build` prove nothing about access control. Run these
with `mcp__supabase__execute_sql`, using three fixture users — owner, editor,
non-member — impersonating each inside a transaction:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user-uuid>","role":"authenticated"}';
-- ...the check...
rollback;
```

| # | Check | Expected |
|---|---|---|
| 1 | non-member SELECT `notes_documents` of a private folder | 0 rows |
| 2 | non-member SELECT `notes_folders` where `visibility = 'private'` | 0 rows |
| 3 | non-member SELECT `notes_folders` where `visibility = 'public'` | metadata row, and its documents still 0 rows |
| 4 | viewer INSERT/UPDATE/DELETE on `notes_documents` | 0 rows affected |
| 5 | non-owner INSERT into `notes_folder_members` | rejected |
| 6 | non-owner UPDATE of `notes_folder_join_requests.status` | 0 rows affected |
| 7 | non-member SELECT `notes_folder_invitations` / `notes_folder_join_requests` | 0 rows |
| 8 | member UPDATE `notes_folders` setting a different `owner_id` | rejected |
| 9 | `notes_search_folders` as non-member | never returns a private folder |
| 9b | `notes_request_join` as non-member on a public folder | returns `requested`, creates **no** membership row |
| 10 | repeat 1–9 as `role anon` | 0 rows / rejected everywhere |
| 11 | a caller holding a `grants_join` tag (no `notes_folder_members` row) SELECTs `notes_folders`, calls `notes_search_folders`, calls `notes_my_folders` for a folder carrying only that tag | folder row/summary present in all three; `my_role` is `null` (no explicit role exists) |
| 12 | same tag-implied caller, after the folder is tombstoned (`deleted = true`) | 0 rows / absent from all three — tag-implied access does not survive a tombstone, unlike an explicit member's view of their own tombstone |
| 13 | tag-implied caller reads `notes_folder_tags` for that folder, or the `tags`/`join_tags` arrays from `notes_search_folders`/`notes_my_folders` | only the tags they personally hold (a `notes_user_tags` row for that `tag_id`) — never a tag on the folder they don't hold |
| 14 | the folder's manager (`notes_can_manage_folder`) reads the same, even for a tag they created but don't hold | every tag on their own folder, unconditionally |
| 15 | an explicit member who is neither the manager nor a holder of a folder's tags | sees the folder itself, but 0 tags in `notes_folder_tags` / empty `tags` arrays |

Then `mcp__supabase__get_advisors` with `type: "security"` and resolve what it
flags (unindexed foreign keys, RLS gaps, mutable search paths).

## TypeScript side

- Server code uses the cookie-bound client from `lib/supabase/server.ts`; client
  components use `lib/supabase/client.ts`. Anon key only — a
  `SUPABASE_SERVICE_KEY` reference appearing anywhere in `lib/`, `app/`, or
  `tools/` is a bug to remove, not a shortcut to use.
- Route handlers under `app/api/collab/` follow the existing house style: named
  `GET`/`POST`/`DELETE`, `catch (err: any)`, `NextResponse.json({ error })` with
  a non-2xx status.
- `middleware.ts` gates on sign-in only; the read-only mode is retired, so
  collaboration routes need no allowlist exception. Don't reintroduce a
  server-wide write flag to protect them.
- Regenerate types with `mcp__supabase__generate_typescript_types` after a schema
  change rather than hand-writing row interfaces.

## UI

Reuse `components/modals/Modal.tsx`, `ConfirmModal.tsx` (every member removal and
folder deletion goes through it), `useToast()`, the hand-rolled icons in
`components/icons/`, and the `group-hover` row-action reveal from
`components/sidebar/FileTreeNode.tsx`. Palette is in
[docs/ui-guidelines.md](../../../docs/ui-guidelines.md).

## Out of scope — do not build

Comments, reactions, likes, reading progress or tracking, hardcoded categories,
translations, notification emails, per-document permissions.
