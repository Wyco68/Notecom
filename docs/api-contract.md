# API Contract

Loaded by `/feat` only. Source of truth is the route files themselves
— this doc is a map, keep it in sync when routes change.

## Next.js API routes (`app/api/`)

| Route | Method | Body | Response |
|---|---|---|---|
| `/api/tree` | GET | — | `{ folders: [{ name, lessons: [{id,slug,title,seq}], quizzes: [...] }] }` |
| `/api/folders` | POST | `{ name }` | `{ ok, folder }` — app slugifies `name` before calling vaultd |
| `/api/folders/[name]` | DELETE | — | `{ ok }` |
| `/api/lesson/[folder]/[id]` | GET | — | `{ html, title }` |
| `/api/lesson/[folder]/[id]` | DELETE | — | `{ ok }` |
| `/api/lesson/[folder]/[id]` | POST | `{ newTitle }` | `{ ok }` (rename) |
| `/api/quiz/[folder]/[id]` | GET | — | `{ html, title }` |
| `/api/quiz/[folder]/[id]` | DELETE | — | `{ ok }` |
| `/api/quiz/[folder]/[id]` | POST | `{ newTitle }` | `{ ok }` (rename) |
| `/api/search` | GET | `?q&folder&kind&limit` | `{ mode: "keyword", results: [chunk hits] }` — proxies indexd |
| `/api/related/[folder]/[id]` | GET | `?kind` | `{ results: [{folder,id,kind,title,score}] }` — proxies indexd |
| `/api/generate` | POST | multipart `file, folder, kind(lect\|quiz)` | `{ jobId }` — saves upload, spawns local Claude Code CLI |
| `/api/generate/[id]` | GET | — | SSE job log (`line` events, then `end` with status) |

Error shape is always `{ error: string }` with a non-2xx status.

There is no route that *generates* anything itself. Content creation happens via
Claude Code (`/lect` for lessons, `/quiz` for quizzes); these routes only start
and observe that local CLI run — see `lib/generate/runner.ts`.

| Route | Method | Body/params | Response |
|---|---|---|---|
| `/api/generate` | GET | — | `{ jobs }` — every job this server process knows, newest first, without log bodies. Lets a reloaded client find a run still in flight and re-attach instead of orphaning it |
| `/api/generate` | POST | multipart `file`, `folder`, `kind` | `{ jobId }` — spawns the CLI and returns immediately |
| `/api/generate/[id]` | GET | — | SSE tail: `line`, `tokens`, then `end` with `{ status, tokens, needsAuth }`. Replays the log from the beginning, so attaching late loses nothing |
| `/api/generate/[id]` | DELETE | — | `{ ok }` — force-stop (the log view's Ctrl+C) |

**Generation is a background job.** The run belongs to the server process, not to
the dialog: `GenerateJobsProvider` (mounted above `AppShell` in
`app/vault/page.tsx`) owns the job list and the SSE follow, so closing the dialog
leaves the run going, the sidebar keeps a live row, the completion toast still
fires and the tree still refreshes when the file lands. At most
`MAX_CONCURRENT_JOBS` (3) run at once — each is a real CLI process spending real
tokens, so background must not also mean unbounded.

## Collaboration (`app/api/collab/`)

Folder sharing, membership and discovery. Every handler runs server-side with
the caller's Supabase JWT and delegates to an RPC or an RLS-guarded select —
these routes add no authorization logic of their own, because the database is
the boundary. Model: [collaboration.md](collaboration.md).

| Route | Method | Body/params | Response |
|---|---|---|---|
| `/api/collab/discover` | GET | `?q&limit&offset` | `{ folders: [...] }` — `notes_search_folders`; returns public folders plus the caller's own, never a private one they don't belong to. **No tag filter**: tags are access grants, so looking up what a tag opens is not offered |
| `/api/collab/my-folders` | GET | — | `{ folders: [...] }` — the caller's own folders with tags/role, used to group the sidebar |
| `/api/collab/me/profile` | GET·POST | `{ username }` | `{ profile }` / `{ ok }` — GET adds `avatarUrl` (a signed URL, not the stored path), `usernameChangeableAt` and `usernameCooldownDays`. POST takes the username only: the rename cooldown is a trigger on `profiles`, so an early attempt comes back 400 with the database's message. Email, password and the photo are **not** changed here — those go through `/auth/reset` and `me/avatar` |
| `/api/collab/me/avatar` | POST·DELETE | multipart `file` | `{ avatarUrl }` / `{ ok }` — uploads to the `profile-avatars` bucket at `{user_id}/avatar.{jpg\|png\|webp}` (JPEG/PNG/WebP, ≤2 MB) and stores that path on the profile. Storage RLS pins the object to the caller's own prefix; the checks in the handler only fail fast with a readable message |
| `/api/collab/me/tags` | GET·DELETE | `?tag` | `{ tags }` / `{ ok }` — **no POST**: a tag cannot be self-assigned, only accepted from a grant |
| `/api/collab/me/grants` | GET·POST·DELETE | `{ username, tag }` / `{ grantId, accept }` / `?username&tag` | GET returns `{ grants, given }`; POST offers a tag to a follower or answers an offer; DELETE revokes a tag you gave, closing every folder it opened |
| `/api/collab/me/follows` | GET·POST·DELETE | `?direction=following\|followers&q&limit&offset` / `{ username }` / `?userId&direction` | GET returns one paged, searchable direction as `{ direction, people, total }` — never the whole graph. Following someone lets **them** tag or invite you |
| `/api/collab/folders/[slug]` | GET | — | `{ folder, role, members, memberTotal, tags }` — `members` is the first page of 10; 404 when RLS hides it |
| `/api/collab/folders/[slug]/settings` | POST | `{ visibility?, description? }` | `{ ok }` — manage-level; written once by the console's "Save changes", not per keystroke. `discoverable`/`joinPolicy` are retired and rejected as unknown fields |
| `/api/collab/folders/[slug]/tags` | POST | `{ tag, grantsJoin }` | `{ ok }` |
| `/api/collab/folders/[slug]/tags` | DELETE | `?tag` | `{ ok }` |
| `/api/collab/folders/[slug]/members` | GET | `?q&limit&offset` | `{ members: [{userId,username,avatarUrl,role,joinedAt}], total }` — paged (default 10, max 50) and searchable by username |
| `/api/collab/folders/[slug]/members` | POST | `{ userId, role }` | `{ ok }` — role change |
| `/api/collab/folders/[slug]/members` | DELETE | `?userId` | `{ ok }` — remove, or leave when it's the caller |
| `/api/collab/folders/[slug]/owner` | POST | `{ userId }` | `{ status }` — transfer ownership; target must already be a member |
| `/api/collab/folders/[slug]/invitations` | GET | — | `{ invitations: [...] }` — manage-level |
| `/api/collab/folders/[slug]/invitations` | POST | `{ username, role }` | `{ ok }` |
| `/api/collab/folders/[slug]/requests` | GET | — | `{ requests: [...] }` — manage-level |
| `/api/collab/folders/[slug]/requests` | POST | `{ requestId, approve }` | `{ ok }` |
| `/api/collab/join` | POST | `{ slug, owner?, message? }` | `{ status: "joined"\|"requested" }` — always `requested` for a non-member now that join policies are gone; `joined` only means "already a member". Holding a tag grants access without either |
| `/api/collab/invitations` | GET | — | `{ invitations: [...] }` — the caller's inbox |
| `/api/collab/invitations` | POST | `{ invitationId, accept }` | `{ ok }` |

`middleware.ts` holds two gates. **Sign-in is required for everything** it
matches — `/api/*`, `/vault/*`, `/discover`, `/account` — with `/api/auth/*`
exempt because that is how a session is obtained; a signed-out page request
redirects to `/auth/sign-in?next=…` and an API request gets 401. On an install
with no Supabase configured the gate stands down, so a purely local vault still
works.

That is the **only** gate — there is no read-only mode. Every instance is
writable by whoever runs it, because generation spawns that person's own Claude
Code CLI on their own subscription; there is no shared resource for a server-wide
flag to protect. What an instance can do is decided by what it has: a box with no
`stored` sidecar and no vault on disk fails a content write because the write has
nowhere to go, not because a flag refused it.

## vaultd (Go helper, default `127.0.0.1:4321`)

| Endpoint | Method | Body | Notes |
|---|---|---|---|
| `/folder` | POST | `{ name }` | creates dir + empty `index.json` if new |
| `/folder/{name}` | DELETE | — | `os.RemoveAll` on the folder |
| `/lesson` | POST | `{ folder, id, slug, title, seq, html }` | writes `{id}.html`, upserts `index.json`'s `lessons` array — used by Claude Code |
| `/lesson/{folder}/{id}` | GET | — | `{ html, title }` |
| `/lesson/{folder}/{id}` | DELETE | — | removes the `.html` file + its index entry |
| `/lesson/{folder}/{id}/rename` | POST | `{ newTitle }` | index-only update |
| `/quiz` | POST | `{ folder, id, slug, title, seq, html }` | writes `quiz-{id}.html`, upserts `index.json`'s `quizzes` array — used by Claude Code |
| `/quiz/{folder}/{id}` | GET | — | `{ html, title }` |
| `/quiz/{folder}/{id}` | DELETE | — | removes the `quiz-{id}.html` file + its index entry |
| `/quiz/{folder}/{id}/rename` | POST | `{ newTitle }` | index-only update |
| `/tree` | GET | — | `{ folders: [{ name, lessons: [...], quizzes: [...] }] }` |

`index.json` holds `{ "lessons": [...], "quizzes": [...] }`. Quiz files share
a folder with lesson files but never collide: quiz filenames carry a `quiz-`
prefix on disk, and each array has its own independent `id`/`seq` sequencing.
Older folders whose `index.json` is still a bare array (lessons only,
pre-quiz format) — or the retired `{lessons,quizzes,assignments}` shape — are
read transparently by vaultd and upgraded to the `{lessons,quizzes}` shape
the next time anything in that folder is saved.

Every name/id arriving at vaultd is already fully resolved by the caller.
Since the offline-first migration the app no longer calls vaultd — its two
callers are Claude Code (`/lect`, `/quiz` save content as files) and stored
(which replays every DB mutation to disk through these endpoints). Don't
`fetch()` vaultd from TypeScript.

## indexd (Go search service, default `127.0.0.1:4322`)

Owns `vault/.index/index.db` (SQLite: metadata + FTS5).
`lib/search/indexd.ts` is the only TypeScript caller. Claude Code may call
it directly over HTTP for retrieval. See
[architecture.md](architecture.md#search-layer-indexd-toolsindexd).

| Endpoint | Method | Body/params | Notes |
|---|---|---|---|
| `/index` | POST | `{ folder, id, kind }` | (re)index one document from disk |
| `/index/{folder}/{id}` | DELETE | `?kind=` | remove one document from the index |
| `/reindex` | POST | — | async full vault scan, answers 202 |
| `/search` | GET | `?q&folder&kind&limit&html=1` | FTS5 keyword search; `html=1` includes chunk HTML |
| `/related/{folder}/{id}` | GET | `?kind&limit` | related documents by an FTS query built from this document's keywords |
| `/topics` | GET | `?q&limit` | matching (topic, document) pairs for a query |
| `/status` | GET | — | `{ documents, chunks, scanning, lastScan }` |

`kind` is `lesson` (default) or `quiz`. Search result chunk
shape: `{ folder, id, kind, title, topic, heading, summary, keywords, seq,
headingIndex, score, html? }` — `headingIndex` is the 0-based occurrence of
the heading text within its document (headings repeat), used by the viewer
to scroll to the matched section. `/search` always answers
`mode: "keyword"`; the field stays because callers already read it.

## Collaboration account sign-in (`/api/auth/collab`)

Identifies a person to other people (the account behind folder sharing) —
separate from the Claude Code CLI sign-in below. Password with a mandatory
email second factor: the password is checked server-side against an in-memory
cookie jar so it never mints a session, and only `verifyOtp` on the 8-digit
emailed code mints one. So a session needs both factors, structurally — there
is no `mfa_ok` flag to forge and no middleware gate. Codes are typed, not
clicked, so no email link is followed and the project's Auth Site URL is never
hit. Pairs with `app/auth/{sign-in,sign-up,reset}` and `lib/auth/collab.ts`.

Password recovery is the one link-based flow, because there is no password left
to prove with: `reset` emails a link whose `redirectTo` is this app's
`/auth/callback`, that route exchanges it for a session, and `set-password`
writes the new password with it. `reset` therefore runs on the **cookie-bound**
client, unlike every other pre-session step — the PKCE code verifier has to
survive in the caller's browser or the exchange fails, which is also why the
link must be opened in the browser that requested it.

| Endpoint | Method | Body | Response |
|---|---|---|---|
| `/api/auth/collab` | POST | `{ action: "signup", email, password }` | `{ ok, factor: "signup" }` — creates the account, emails a confirm code |
| `/api/auth/collab` | POST | `{ action: "password", email, password }` | `{ ok, factor: "email" }` — verifies the password (no session), emails a login code; `401` on bad creds |
| `/api/auth/collab` | POST | `{ action: "verify", email, token, factor }` | `{ ok }` — `verifyOtp` on the 8-digit `token` mints the session (`factor` `"email"`\|`"signup"`); a non-numeric token is rejected |
| `/api/auth/collab` | POST | `{ action: "reset", email }` | `{ ok, factor: "recovery" }` — emails a recovery **link** pointing at `/auth/callback`; never reveals if the email exists |
| `/api/auth/collab` | POST | `{ action: "set-password", password }` | `{ ok }` — sets the password on the session `/auth/callback` just created; `401` if that link expired |

Needs `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` (else `501`). Supabase template
requirements follow the split: **"Confirm signup" and "Magic Link" must expose
`{{ .Token }}`** (they carry the sign-up and sign-in codes — on the default
templates no code is sent and neither flow can complete), while **"Reset
Password" keeps the default `{{ .ConfirmationURL }}` link**. "Confirm email"
must stay ON, and every origin the app is served from needs `/auth/callback` in
the project's Redirect URLs — the deployment's URL for a hosted reader, and a
port wildcard (`http://127.0.0.1:*/auth/callback`) for the desktop build, which
starts Next on a free port chosen at launch (`desktop/src/lib.rs`). Without a
matching entry Supabase ignores `redirectTo` and sends the user to the
project's Site URL instead, so recovery would land in another app.

## Claude Code sign-in (`/api/auth`)

Drives the local CLI's own auth so an expired session can be fixed from the
app instead of a terminal the packaged build doesn't have. `lib/auth/cli.ts`
shells out to `claude auth status|login|logout`; the app never reads, stores
or forwards the credential — the CLI keeps it, exactly as from a terminal.
There is deliberately no API-key field.

| Endpoint | Method | Body/params | Notes |
|---|---|---|---|
| `/api/auth` | GET | — | `{ loggedIn, authMethod }` from `claude auth status --json` |
| `/api/auth` | POST | `{ action: "login", mode }` | starts `claude auth login` (`claudeai` or `console`); one flow at a time |
| `/api/auth` | POST | `{ action: "code", code }` | forwards a pasted authorization code to the waiting CLI's stdin; never stored |
| `/api/auth` | POST | `{ action: "logout" }` | clears the CLI's stored credential |
| `/api/auth` | DELETE | — | cancels the in-flight login |
| `/api/auth/stream` | GET | — | SSE: `line`, `meta` (OAuth url, awaitingCode), `end` |

Never gated: signing the CLI in is how a user makes generation work on their own
machine. Success is confirmed by re-reading `auth status`, not by the login
process's exit code.

## stored (Go primary datastore + sync service, default `127.0.0.1:4323`)

Owns the live SQLite database (`<vault>/.data/notes.db`) — the app's source
of truth — and the background Supabase sync worker. `lib/vault/helper.ts`
is the only TypeScript caller. The CRUD surface deliberately mirrors
vaultd's contract 1:1 (same paths, bodies, responses), so it is not
repeated here; the differences are:

| Endpoint | Method | Body/params | Notes |
|---|---|---|---|
| `/import` | POST | — | scan `vault/` and upsert anything that differs into SQLite (disk wins); idempotent; never enqueues sync ops. `/api/tree` awaits this so Claude-authored files appear immediately |
| `/status` | GET | — | `{ ok, folders, queued, last_sync, sync }` — `sync` is `{ enabled, signed_in, user_id, last_error, last_push }` |

Behavioral differences from vaultd behind the shared contract: every
mutation commits atomically with one `sync_queue` row (drained to Supabase
by the 30s background worker — batched upserts, tombstone deletes,
Last-Write-Wins by `version` then `updated_at`), and every mutation is
mirrored back to `vault/` by calling vaultd, keeping the file tree a live
legacy-format export for indexd and Claude Code.

Sync is enabled by `SUPABASE_URL` + `SUPABASE_ANON_KEY` plus a user credential
(env or `<vault>/.data/sync.env`); absent, stored runs fully local. Absent is a
*silent* state by design — the app keeps working against SQLite — so the reason
is reported in two places rather than only in a log: startup names the missing
variable (`sync: DISABLED — SUPABASE_PASSWORD is empty…`), and `/status`'s
`sync` object carries `signed_in` plus the last cycle's `last_error`. Check it
first when local content is not reaching Supabase. stored
signs in as that user and sends its access token, so **RLS decides what it may
push and pull** — it never holds a service-role key and never sees another
user's folders. Remote tables: `notes_folders`, `notes_documents`, and the
`notes_folder_*` collaboration tables (server-trigger `synced_at` is the pull
cursor). A 403 on push means the local role lacks `can_write` for that folder;
the queue row resolves rather than retrying forever.

Error shape is `{ error: string }` with a non-2xx status, matching the
Next.js routes.
