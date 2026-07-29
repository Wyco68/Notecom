# Collaboration

Loaded by `/feat` only, and only for tasks touching folder sharing, roles,
membership, or Supabase RLS. This is the contract; the SQL in
`supabase/migrations/` is the implementation.

## The model in one paragraph

A **folder is the unit of collaboration**. It has one owner, a member list with
roles, a visibility setting, and tags. Documents (lessons and quizzes) inherit
their folder's permissions completely — there is no per-document permission
column and there must never be one. Users find folders through search, and
reach them by invitation (owner → user), by request (user → owner, always
approved by the owner), or by **holding a tag the folder carries**.

Two rules override everything below, and are the reason the rest is shaped as it
is:

1. **Files are members-only, always.** A folder's `visibility` controls who sees
   that the folder *exists*; it never controls who can read what is inside.
   `notes_documents` is gated by `notes_is_folder_member()`, never by
   `notes_can_read_folder()`. This is why folders can default to public safely.
2. **Joining never grants writing.** Membership obtained by request or by tag is
   `viewer`. `editor` is reachable only through an explicit invitation or a role
   change by a manager.

Deliberately absent, and not to be added: comments, reactions, likes, reading
progress or tracking, hardcoded categories, translations. This is a note-sharing
tool, not a social network.

## Identity

Users are `public.profiles` rows (`profiles.id` → `auth.users.id`), the same
table BookCommunity uses in this Supabase project. There is exactly one identity
pool. Never create a second profile table, never duplicate `username` or
`avatar_url`.

Because the table is shared, its two triggers are shared rules, not this app's
preferences — changing either changes BookCommunity too:

- `enforce_profiles_username` lowercases and validates the name, and refuses a
  rename within **15 days** of the last one (`username_updated_at`). Set in
  `0014_notes_profile_username_cooldown.sql`; the app mirrors the number only to
  label the next allowed date.
- `enforce_profiles_avatar_url` accepts either an absolute `http(s)` URL
  (historical rows) or exactly `{profiles.id}/avatar.{jpg|jpeg|png|webp}` — a
  path in the private `profile-avatars` bucket. This app writes only the path
  form, and a row can therefore never point at another user's object.

The bucket is private, so a stored path is not a usable `src`: reads go through a
short-lived signed URL minted with the caller's own JWT (`lib/collab/avatar.ts`).
Storage policies confine writes to a `{auth.uid()}/…` prefix and allow reads to
any authenticated user, which is what lets one person see another's avatar.

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

## Visibility is one axis, and it is not file access

`visibility` decides who can see that a folder *exists*:

| | who sees the folder |
|---|---|
| `visibility = 'public'` | anyone signed in — in search, metadata only |
| `visibility = 'private'` | members only |

"Public" means *listed*, never *readable*: the files inside are gated by
`notes_is_folder_member()` either way. A migration must never publish
retroactively — a folder that was hidden stays hidden.

Two settings used to sit beside it and are **retired** (0012): `discoverable`
restated what `visibility` already said, and `join_policy` offered instant and
invite-only variants nobody wanted. Both columns survive in the table because
`stored` still ships them in its sync payload, but nothing reads them; don't
reintroduce either as a product concept.

## Joining

One path: the user files a `notes_folder_join_requests` row through
`notes_request_join()` and the owner approves or rejects it. Requesting a
folder you cannot see raises "no such folder" rather than confirming it exists,
and an approved request is what creates the `viewer` membership row — the RPC
never joins anyone outright. The other way in is holding a `grants_join` tag,
which bypasses requests entirely (below).

Invitations are `notes_folder_invitations` rows
(`pending` → `accepted` | `declined` | `revoked`). Requests are
`notes_folder_join_requests` rows (`pending` → `approved` | `rejected`).

## Follows, and tags as credentials

Following is a **one-sided** edge (`notes_follows`) needing no approval. Its only
power is permissive in one direction: following someone lets *them* offer you a
tag or invite you to a folder. Both `notes_grant_tag()` and
`notes_invite_member()` refuse unless the target follows the caller, which is
what keeps strangers from tagging or inviting anyone they like.

A tag is therefore **a claim someone else makes about you**, never self-assigned:

```
A follows B  →  B grants tag T to A  →  A accepts  →  A holds T
                                                    →  every folder tagged T
                                                       (grants_join) is readable by A
```

Holding a tag grants read access to every folder carrying that tag with
`grants_join = true`, with **no join step and no membership row** —
`notes_is_folder_member()` treats a held tag as implied membership. Two
consequences that matter:

- Dropping a tag revokes every folder it was opening, at once. That is the
  point of granting by tag rather than by invitation. Either side can do it:
  the holder removes it from Account Settings, and the granter calls
  `notes_revoke_tag()` to stop vouching. A tag granted by two people survives
  until the last grant is revoked, so one person cannot strip another's grant.
- Implied access is read-only, and an explicit `notes_folder_members` row always
  wins, since it is the only thing `notes_can_write_folder()` consults.

**Tags are deliberately not searchable.** A tag is a credential now, so
`notes_search_folders` cannot filter or match on one — being able to ask "which
folders does ISNE3RD open" would publish exactly the list worth acquiring it
for. Folder tags stay visible on a folder you can already see; they are simply
not a way to find one.

## Tables and why each exists

Existing tables are extended in preference to new ones.

| Table | Why |
|---|---|
| `profiles` | *(existing)* the one identity pool, shared with BookCommunity |
| `notes_folders` | *(existing, extended)* gains `owner_id`, `description`, `visibility`, `search_tsv`. `discoverable`/`join_policy` are retired leftovers kept only for `stored`'s sync payload |
| `notes_documents` | *(existing, unchanged)* permissions are inherited from the folder — adding a permission column here is a design error |
| `notes_folder_roles` | makes roles data instead of code, so the set is extensible |
| `notes_folder_members` | the membership edge; composite PK `(folder_id, user_id)` |
| `notes_tags` | normalized free-form tag vocabulary, user-created — deliberately not the hardcoded `categories` table |
| `notes_folder_tags` | folder↔tag edge, plus the per-tag `grants_join` flag |
| `notes_user_tags` | user↔tag edge — the other half of the match; written only by accepting a grant |
| `notes_tag_grants` | a tag offered to a follower, `pending` → `accepted` \| `declined` \| `revoked` |
| `notes_follows` | one-sided follow edge; the gate for tagging and inviting |
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
| `notes_is_folder_member(folder)` | member row ∨ holds a `grants_join` tag the folder carries — **the gate on files** |
| `notes_can_read_folder(folder)` | owner ∨ member ∨ tag-implied ∨ `visibility = 'public'` — folder metadata only, and the only axis discovery consults |
| `notes_follows_me(user)` | that user follows the caller |
| `notes_can_write_folder(folder)` | the caller's role has `can_write` |
| `notes_can_manage_folder(folder)` | the caller's role has `can_manage` |

Action RPCs — the only writers of `notes_folder_members`:

`notes_invite_member(folder, username, role)` *(requires the invitee follows the caller)*,
`notes_respond_invitation(invitation, accept)`,
`notes_request_join(folder, message)`,
`notes_respond_join_request(request, approve)`,
`notes_grant_tag(username, label)` *(requires the grantee follows the caller)*,
`notes_respond_tag_grant(grant, accept)`,
`notes_set_member_role(folder, user, role)`,
`notes_remove_member(folder, user)`,
`notes_leave_folder(folder)`,
`notes_transfer_ownership(folder, user)`,
`notes_search_folders(q, limit, offset)`.

Retired: `notes_join_by_tag()` and `notes_suggested_folders()`. Both turned a tag
into a membership row through a join; there is no join in the tag path any more.

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
