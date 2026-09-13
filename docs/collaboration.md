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
approved by the owner), or — for a new account — by onboarding into the
**featured** folders. Every way in is an explicit membership row.

Two rules override everything below, and are the reason the rest is shaped as it
is:

1. **Files are members-only, always.** A folder's `visibility` controls who sees
   that the folder *exists*; it never controls who can read what is inside.
   `notes_documents` is gated by `notes_is_folder_member()`, never by
   `notes_can_read_folder()`. This is why folders can default to public safely.
2. **Joining never grants writing.** Membership obtained by request or by onboarding is
   `viewer`. `editor` is reachable only through an explicit invitation or a role
   change by a manager.

The social layer is deliberately light: public **profiles** and a **home feed**
of what you can already read. Deliberately absent, and not to be added without
revisiting this doc: comments, reactions, likes, reading progress or tracking,
hardcoded categories, translations.

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
`resolveAvatarUrl` signs one path; every list that shows more than one person
(members, follows, follow requests, invitations, tag grants, folder search)
uses the batch form, `resolveAvatarUrls` — one `createSignedUrls` call per
function, not one per row.

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
invite-only variants nobody wanted. Both columns survive in the table only
because dropping a column is not worth a migration, but nothing reads them;
don't reintroduce either as a product concept.

## Joining

One path: the user files a `notes_folder_join_requests` row through
`notes_request_join()` and the owner approves or rejects it. Requesting a
folder you cannot see raises "no such folder" rather than confirming it exists,
and an approved request is what creates the `viewer` membership row — the RPC
never joins anyone outright. The only other automatic way in is onboarding
into featured folders (below).

Invitations are `notes_folder_invitations` rows
(`pending` → `accepted` | `declined` | `revoked`). Requests are
`notes_folder_join_requests` rows (`pending` → `approved` | `rejected`).

## Follows

Following (`notes_follows`) is **one-sided in direction but requires the other
side's consent**: it starts `pending` when the follower requests it, and only
counts once the followee accepts (`notes_respond_follow()`) — declining deletes
the request outright. An accepted follow does two things, both permissive in one
direction: the follower's Home feed shows the followee's newly published
**public** folders (metadata only), and the followee may invite the follower to
a folder (`notes_invite_member()` checks `notes_follows_me()`). A pending
request does neither.

`GET /api/collab/me/follows` only returns `accepted` edges; incoming pending
requests are `GET /api/collab/me/follow-requests`, surfaced in Notifications.

The one pre-accepted follow is onboarding's, below.

## Topics (tags are not access)

Tags were credentials from 0009 to 0025 — follow, receive a grant, accept, and
every folder carrying the tag opened. **0026 retired that entirely.**
`notes_is_folder_member()` is membership only; the grant/accept/revoke/claim
RPCs lost EXECUTE; `notes_user_tags`, `notes_tag_grants`,
`notes_folder_tags.grants_join` and `notes_tags.self_serve` survive only as
inert columns (the 0012 precedent — not worth a drop). Don't reintroduce any of
them as an access path.

A tag is now a **topic**: a label a manager puts on a folder (typed freely in
`FolderManagePanel`; `ensureTag` reuses an existing slug). Topics are visible to
anyone who can see the folder (`notes_folder_tags` SELECT is
`notes_can_read_folder`) and `notes_search_folders` matches on them, so Discover
finds folders by topic. They grant nothing.

## Featured folders and onboarding

A new account owns nothing and belongs to nothing. `notes_folders.featured`
(0028) is an owner's standing offer that anyone new may start in that folder,
and `notes_onboard()` acts on it **once per account**:

- a `viewer` membership in every non-deleted featured folder;
- an **accepted** follow of each featured folder's owner. This is the single
  exception to follow consent, and it is justified by the featured flag itself:
  featuring a folder is the owner's consent to being followed by newcomers.

`notes_profiles_onboarded` records that it ran, so the RPC answers `0` on every
later call and a reader who leaves a featured folder is never put back. The app
calls it on every workspace mount (`AppShell`) and needs no client state.
`featured` is not client-writable — authenticated holds column-level UPDATE on
other columns only — so featuring is a migration decision for now. Currently
featured: `General-Education`, `Wireless-Network`, `Operating-System` (wyco),
all `public`.

## Feed and profiles

Both only ever surface what the caller can already see — they are new views,
not new access.

- `notes_feed(before, limit)`: `doc` items are documents in folders the caller
  is a **member** of; `folder` items are **public** folders created by someone
  the caller follows (accepted), metadata only. A document title from a folder
  the caller is not in never appears. Keyset-paged on the item time.
- `notes_profile(username)`: accepted follower/following counts, public folder
  count, and the caller's own `follow_state` (`none|pending|accepted|self`).
- `notes_user_folders(username, limit, offset)`: that person's folders filtered
  by `notes_can_read_folder` — public ones plus private ones the caller is in —
  featured first, in the discovery shape.

## Tables and why each exists

Existing tables are extended in preference to new ones.

| Table | Why |
|---|---|
| `profiles` | *(existing)* the one identity pool, shared with BookCommunity |
| `notes_folders` | *(existing, extended)* gains `owner_id`, `description`, `visibility`, `search_tsv`, `featured`. `discoverable`/`join_policy` are retired leftovers nothing reads |
| `notes_documents` | *(existing, unchanged)* permissions are inherited from the folder — adding a permission column here is a design error |
| `notes_folder_roles` | makes roles data instead of code, so the set is extensible |
| `notes_folder_members` | the membership edge; composite PK `(folder_id, user_id)` |
| `notes_tags` | normalized free-form **topic** vocabulary, user-created — deliberately not the hardcoded `categories` table. `self_serve` is an inert leftover of 0025 |
| `notes_folder_tags` | folder↔topic edge, visible to anyone who can see the folder. `grants_join` is inert since 0026 |
| `notes_user_tags` | *(inert since 0026)* held tags from the credential era |
| `notes_tag_grants` | *(inert since 0026)* tag offers from the credential era |
| `notes_profiles_onboarded` | one row per account that has run `notes_onboard()` — what makes it once-only |
| `notes_follows` | follow edge, `pending` → `accepted` (or deleted on decline); once accepted, feeds public folders and gates inviting |
| `notes_folder_invitations` | owner → user direction |
| `notes_folder_join_requests` | user → owner direction |

## Security rules (non-negotiable)

1. **No service-role key exists anywhere in this app.** Not in `lib/`, not in
   an env file, not in the Docker image. Every read and write carries a user JWT
   and passes through RLS. If a task seems to need the service key, the RLS
   policy is wrong — fix the policy.
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

`notes_folders`' SELECT policy is
`notes_folder_role(id) IS NOT NULL OR notes_can_read_folder(id)`: an explicit
member sees their folders **including tombstones** (`deleted = true`), via the
first clause, so a client holding an older copy can tell "removed" from
"never existed". `notes_can_read_folder()` deliberately does *not* include
tombstones — it requires `deleted = false` — so documents and membership rows
belonging to a deleted folder stop being readable the moment the folder is
tombstoned, and so does tag-implied access: a tombstoned folder stops granting
entry to its tag holders rather than continuing to. That is the intended
asymmetry — the folder tombstone alone is enough to propagate the delete for
everyone but an explicit member, and a cascade removes the rest locally.

## Helper functions and RPCs

Predicates used by policies (`STABLE SECURITY DEFINER`):

| Function | True when |
|---|---|
| `notes_folder_role(folder)` | returns the caller's role text, or NULL |
| `notes_is_folder_member(folder)` | the caller has a member row — **the gate on files** |
| `notes_can_read_folder(folder)` | member ∨ `visibility = 'public'` — folder metadata only, and the only axis discovery consults |
| `notes_follows_me(user)` | that user follows the caller with an **accepted** `notes_follows` row — a pending request doesn't count |
| `notes_can_write_folder(folder)` | the caller's role has `can_write` |
| `notes_can_manage_folder(folder)` | the caller's role has `can_manage` |

Action RPCs — the only writers of `notes_folder_members`:

`notes_invite_member(folder, username, role)` *(requires the invitee follows the caller)*,
`notes_respond_invitation(invitation, accept)`,
`notes_request_join(folder, message)`,
`notes_respond_join_request(request, approve)`,
`notes_onboard()` *(once per account; featured folders + their owners)*,
`notes_respond_follow(follower, accept)` *(caller must be the followee on a `pending` row; decline deletes it)*,
`notes_set_member_role(folder, user, role)`,
`notes_remove_member(folder, user)`,
`notes_leave_folder(folder)`,
`notes_transfer_ownership(folder, user)`,
`notes_search_folders(q, limit, offset)` *(matches topics)*.

Read RPCs for the social layer: `notes_feed(before, limit)`,
`notes_profile(username)`, `notes_user_folders(username, limit, offset)`.

Retired: `notes_join_by_tag()`, `notes_suggested_folders()`, and since 0026
`notes_grant_tag()`, `notes_respond_tag_grant()`, `notes_revoke_tag()`,
`notes_granted_tags()` and `notes_claim_tag()` (EXECUTE revoked from everyone).

Invite-by-username resolves `profiles.username` inside the function, so the
`profiles` table never needs a broad SELECT policy for member search.

## Where the code lives

| Concern | Location |
|---|---|
| SQL schema, functions, policies | `supabase/migrations/` — append-only, never edit an applied file |
| Supabase client factories | `lib/supabase/server.ts`, `lib/supabase/client.ts` — anon key only, no business logic |
| Collaboration data layer | `lib/collab/*.ts` — typed wrappers over the RPCs |
| HTTP surface | `app/api/collab/**` — see [api-contract.md](api-contract.md) |
| UI | `components/collab/` — `FeedPanel` (Home, shown when no document is open), `ProfilePanel`, `DiscoverPanel`, `PeoplePanel` and `FolderManagePanel` render in the workspace's content column (AppShell) and as the standalone `app/u/[username]/`, `app/discover/`, `app/people/`, `app/vault/[folder]/manage/` routes a deep link lands on. `NotificationsPanel` renders invitations and follow requests as one merged list, fed by `NotificationsProvider` (the single reader of those two endpoints) and opened from the `SidebarNav` nav group — which is present whether or not anything is pending |

Content persistence (`lib/vault/store.ts`) runs on the same user-scoped client
and holds no permission logic of its own — same rule as slugs and sequences:
every value arrives resolved, and the database decides the rest.

## Verifying a change

Type and build checks are not evidence that RLS works. Prove it with SQL, as
each role, before calling a change done — the checklist is in
[.claude/skills/collab/SKILL.md](../.claude/skills/collab/SKILL.md).
