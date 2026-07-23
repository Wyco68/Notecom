# Collaboration

Loaded by `/feat` only, and only for tasks touching folder sharing, roles,
membership, or Supabase RLS. This is the contract; the SQL in
`supabase/migrations/` is the implementation.

## The model in one paragraph

A **folder is the unit of collaboration**. It has one owner, a member list with
roles, a visibility setting, a discoverability setting, a join policy, and tags.
Documents (lessons and quizzes) inherit their folder's permissions completely —
there is no per-document permission column and there must never be one. Users
find folders through search or tags, and join by invitation (owner → user) or by
request (user → owner).

Deliberately absent, and not to be added: comments, reactions, likes, reading
progress or tracking, hardcoded categories, translations. This is a note-sharing
tool, not a social network.

## Identity

Users are `public.profiles` rows (`profiles.id` → `auth.users.id`), the same
table BookCommunity uses in this Supabase project. There is exactly one identity
pool. Never create a second profile table, never duplicate `username` or
`avatar_url`.

Note that `lib/auth/*` and `/api/auth` are the **Claude Code CLI's** sign-in and
have nothing to do with user accounts. Don't extend them for user auth.

## Roles

Roles are rows in `notes_folder_roles`, not a CHECK constraint and not an enum.
Adding a role later must be one `INSERT`, never a policy rewrite.

| role | rank | can_write | can_manage |
|---|---|---|---|
| `owner` | 30 | true | true |
| `editor` | 20 | true | false |
| `viewer` | 10 | false | false |

- `can_write` — create, edit, rename, delete documents in the folder.
- `can_manage` — invite, remove, change roles, edit folder settings and tags,
  answer join requests, delete the folder.

Every folder has exactly one `owner` member row, kept in step with
`notes_folders.owner_id` by a trigger. Owners cannot be removed or demoted; they
transfer ownership or delete the folder.

## Visibility and discoverability are two axes

Collapsing them into one flag is the mistake to avoid.

| | `discoverable = true` | `discoverable = false` |
|---|---|---|
| `visibility = 'public'` | in search; anyone signed in can read the notes | members only, invisible |
| `visibility = 'private'` | in search as **metadata only** (name, description, tags, owner) — notes stay members-only | members only, invisible |

So: *every folder is searchable unless the owner turns discoverability off*, and
a private folder's contents are never readable by a non-member regardless of
discoverability. The rule is enforced in SQL by `notes_search_folders` and the
`notes_folders` SELECT policy — never by hiding a button.

## Joining

`join_policy` on the folder:

- `open` — any signed-in user who can see the folder joins instantly as `viewer`.
- `request` — user files a `notes_folder_join_requests` row; owner approves or
  rejects.
- `invite_only` — no self-service path; the owner invites.

Invitations are `notes_folder_invitations` rows
(`pending` → `accepted` | `declined` | `revoked`). Requests are
`notes_folder_join_requests` rows (`pending` → `approved` | `rejected`).

**Tag-granted joining** is per tag, not per folder: a `notes_folder_tags` row
with `grants_join = true` means "anyone who reached us through this tag may join
without approval, regardless of `join_policy`". This keeps tags a discovery
mechanism that can *optionally* carry an access grant, instead of a second
parallel permission system.

## Tables and why each exists

Existing tables are extended in preference to new ones.

| Table | Why |
|---|---|
| `profiles` | *(existing)* the one identity pool, shared with BookCommunity |
| `notes_folders` | *(existing, extended)* gains `owner_id`, `description`, `visibility`, `discoverable`, `join_policy`, `search_tsv` |
| `notes_documents` | *(existing, unchanged)* permissions are inherited from the folder — adding a permission column here is a design error |
| `notes_folder_roles` | makes roles data instead of code, so the set is extensible |
| `notes_folder_members` | the membership edge; composite PK `(folder_id, user_id)` |
| `notes_tags` | normalized free-form tag vocabulary, user-created — deliberately not the hardcoded `categories` table |
| `notes_folder_tags` | folder↔tag edge, plus the per-tag `grants_join` flag |
| `notes_folder_invitations` | owner → user direction |
| `notes_folder_join_requests` | user → owner direction |

## Security rules (non-negotiable)

1. **No service-role key exists anywhere in this app.** Not in `lib/`, not in
   `tools/stored/`, not in an env file for the web deployment. Every read and
   write carries a user JWT and passes through RLS. If a task seems to need the
   service key, the RLS policy is wrong — fix the policy.
2. **Deny by default.** Every table has RLS enabled and explicit policies. `anon`
   is granted nothing.
3. **Frontend checks are cosmetic.** Hiding a button is UX. Assume any client can
   call any endpoint with any payload; the database is what stops it.
4. **Membership is written only by `SECURITY DEFINER` RPCs.** `notes_folder_members`
   has no INSERT policy for ordinary callers — accepting an invitation or
   approving a request goes through a function that re-checks authorization
   itself. The one exception is a self-`DELETE` so a member can leave.
5. **Policies call helper functions, never subquery the members table directly.**
   A policy on `notes_folder_members` that queries `notes_folder_members`
   recurses. `notes_can_read_folder()` and friends are `STABLE SECURITY DEFINER`
   precisely to break that cycle, and they keep each policy one readable line.
6. **RPCs validate their own arguments.** `SECURITY DEFINER` means RLS is off
   inside the function body; the first statements must establish who the caller
   is and what they may do.

### Tombstones and visibility

`notes_folders`' SELECT policy lets a member see their folders **including
tombstones** (`deleted = true`), because `stored` needs the tombstone to
replicate a delete to other devices. `notes_can_read_folder()` deliberately does
*not*: it requires `deleted = false`, so documents and membership rows belonging
to a deleted folder stop being readable the moment the folder is tombstoned.
That is the intended asymmetry — the folder tombstone alone is enough to
propagate the delete, and a cascade removes the rest locally.

## Helper functions and RPCs

Predicates used by policies (`STABLE SECURITY DEFINER`):

| Function | True when |
|---|---|
| `notes_folder_role(folder)` | returns the caller's role text, or NULL |
| `notes_can_read_folder(folder)` | owner ∨ member ∨ `visibility = 'public'` |
| `notes_can_write_folder(folder)` | the caller's role has `can_write` |
| `notes_can_manage_folder(folder)` | the caller's role has `can_manage` |

Action RPCs — the only writers of `notes_folder_members`:

`notes_invite_member(folder, username, role)`,
`notes_respond_invitation(invitation, accept)`,
`notes_request_join(folder, message)`,
`notes_respond_join_request(request, approve)`,
`notes_join_by_tag(folder, tag_slug)`,
`notes_set_member_role(folder, user, role)`,
`notes_remove_member(folder, user)`,
`notes_leave_folder(folder)`,
`notes_search_folders(q, tags, limit, offset)`.

Invite-by-username resolves `profiles.username` inside the function, so the
`profiles` table never needs a broad SELECT policy for member search.

## Where the code lives

| Concern | Location |
|---|---|
| SQL schema, functions, policies | `supabase/migrations/` — append-only, never edit an applied file |
| Supabase client factories | `lib/supabase/server.ts`, `lib/supabase/client.ts` — anon key only, no business logic |
| Collaboration data layer | `lib/collab/*.ts` — typed wrappers over the RPCs |
| HTTP surface | `app/api/collab/**` — see [api-contract.md](api-contract.md) |
| UI | `app/discover/`, `app/vault/[folder]/manage/`, `components/collab/` |

`stored` (`tools/stored/`) authenticates to Supabase as the signed-in user and
therefore syncs only what RLS allows it to see. It holds no permission logic of
its own — same rule as slugs and sequences: every value arrives resolved.

## Verifying a change

Type and build checks are not evidence that RLS works. Prove it with SQL, as
each role, before calling a change done — the checklist is in
[.claude/skills/collab/SKILL.md](../.claude/skills/collab/SKILL.md).
