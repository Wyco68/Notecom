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
| `/api/search` | GET | `?q&folder&kind&limit` | `{ mode: "hybrid"\|"keyword", results: [chunk hits] }` — proxies indexd |
| `/api/related/[folder]/[id]` | GET | `?kind` | `{ results: [{folder,id,kind,title,score}] }` — proxies indexd |
| `/api/chat` | POST | `{ message, history }` | SSE passthrough of indexd `/chat` (sources → deltas → done) |
| `/api/generate` | POST | multipart `file, folder, kind(lect\|quiz)` | `{ jobId }` — saves upload, spawns local Claude Code CLI |
| `/api/generate/[id]` | GET | — | SSE job log (`line` events, then `end` with status) |

Error shape is always `{ error: string }` with a non-2xx status.

There is no lesson- or quiz-generation route. Content creation happens via
Claude Code (`/lect` for lessons, `/quiz` for quizzes), not the web app.

## Collaboration (`app/api/collab/`)

Folder sharing, membership and discovery. Every handler runs server-side with
the caller's Supabase JWT and delegates to an RPC or an RLS-guarded select —
these routes add no authorization logic of their own, because the database is
the boundary. Model: [collaboration.md](collaboration.md).

| Route | Method | Body/params | Response |
|---|---|---|---|
| `/api/collab/discover` | GET | `?q&tags&limit&offset` | `{ folders: [{slug,name,description,owner,tags,members,joinPolicy,visibility}] }` — `notes_search_folders`; never returns a non-discoverable folder to a non-member |
| `/api/collab/tags` | GET | `?q` | `{ tags: [{slug,label,folders}] }` |
| `/api/collab/folders/[slug]` | GET | — | `{ folder, role, members, tags }` — 404 when RLS hides it |
| `/api/collab/folders/[slug]/settings` | POST | `{ visibility?, discoverable?, joinPolicy?, description? }` | `{ ok }` — manage-level |
| `/api/collab/folders/[slug]/tags` | POST | `{ tag, grantsJoin }` | `{ ok }` |
| `/api/collab/folders/[slug]/tags` | DELETE | `?tag` | `{ ok }` |
| `/api/collab/folders/[slug]/members` | GET | — | `{ members: [{userId,username,avatarUrl,role,joinedAt}] }` |
| `/api/collab/folders/[slug]/members` | POST | `{ userId, role }` | `{ ok }` — role change |
| `/api/collab/folders/[slug]/members` | DELETE | `?userId` | `{ ok }` — remove, or leave when it's the caller |
| `/api/collab/folders/[slug]/invitations` | GET | — | `{ invitations: [...] }` — manage-level |
| `/api/collab/folders/[slug]/invitations` | POST | `{ username, role }` | `{ ok }` |
| `/api/collab/folders/[slug]/requests` | GET | — | `{ requests: [...] }` — manage-level |
| `/api/collab/folders/[slug]/requests` | POST | `{ requestId, approve }` | `{ ok }` |
| `/api/collab/join` | POST | `{ slug, via: "open"\|"request"\|"tag", tag?, message? }` | `{ status: "joined"\|"requested" }` |
| `/api/collab/invitations` | GET | — | `{ invitations: [...] }` — the caller's inbox |
| `/api/collab/invitations` | POST | `{ invitationId, accept }` | `{ ok }` |

`READ_ONLY=1` blocks non-GET `/api/*` in `middleware.ts`; `/api/collab/` is
allowlisted alongside `/api/chat`, since these are membership writes rather
than note-content writes. Unauthenticated callers get 401.

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

## indexd (Go search/RAG service, default `127.0.0.1:4322`)

Owns `vault/.index/index.db` (SQLite: metadata + FTS5 + embedding BLOBs).
`lib/search/indexd.ts` is the only TypeScript caller. Claude Code may call
it directly over HTTP for retrieval. See
[architecture.md](architecture.md#search-layer-indexd-toolsindexd).

| Endpoint | Method | Body/params | Notes |
|---|---|---|---|
| `/index` | POST | `{ folder, id, kind }` | (re)index one document from disk |
| `/index/{folder}/{id}` | DELETE | `?kind=` | remove one document from the index |
| `/reindex` | POST | — | async full vault scan, answers 202 |
| `/search` | GET | `?q&folder&kind&limit&html=1` | hybrid FTS5+vector, RRF-merged; `html=1` includes chunk HTML |
| `/related/{folder}/{id}` | GET | `?kind&limit` | related documents by embedding centroid (keyword fallback) |
| `/topics` | GET | `?q&limit` | matching (topic, document) pairs for a query |
| `/chat` | POST | `{ message, history }` | grounded chat: retrieves top chunks, streams a local Ollama chat model (`CHAT_MODEL`, default `llama3.2`) as SSE; 503 without Ollama |
| `/status` | GET | — | `{ documents, chunks, embedded, ollama, model, scanning, lastScan }` |

`kind` is `lesson` (default) or `quiz`. Search result chunk
shape: `{ folder, id, kind, title, topic, heading, summary, keywords, seq,
headingIndex, score, html? }` — `headingIndex` is the 0-based occurrence of
the heading text within its document (headings repeat), used by the viewer
to scroll to the matched section. Embeddings come from a local Ollama server
(`OLLAMA_URL`, model `EMBED_MODEL`, default `nomic-embed-text`); without
Ollama, `/search` serves `mode: "keyword"` (FTS5-only) and embeddings
backfill on a later scan.

## Collaboration account sign-in (`/api/auth/collab`)

Identifies a person to other people (the account behind folder sharing) —
separate from the Claude Code CLI sign-in below. Password with a mandatory
email second factor: the password is checked server-side against an in-memory
cookie jar so it never mints a session, and only `verifyOtp` on the 6-digit
emailed code mints one. So a session needs both factors, structurally — there
is no `mfa_ok` flag to forge and no middleware gate. Codes are typed, not
clicked, so no email link is followed and the project's Auth Site URL is never
hit. Pairs with `app/auth/{sign-in,sign-up,reset}` and `lib/auth/collab.ts`.

| Endpoint | Method | Body | Response |
|---|---|---|---|
| `/api/auth/collab` | POST | `{ action: "signup", email, password }` | `{ ok, factor: "signup" }` — creates the account, emails a confirm code |
| `/api/auth/collab` | POST | `{ action: "password", email, password }` | `{ ok, factor: "email" }` — verifies the password (no session), emails a login code; `401` on bad creds |
| `/api/auth/collab` | POST | `{ action: "verify", email, token, factor }` | `{ ok }` — `verifyOtp` mints the session (`factor` `"email"`\|`"signup"`) |
| `/api/auth/collab` | POST | `{ action: "reset", email }` | `{ ok, factor: "recovery" }` — emails a recovery code; never reveals if the email exists |
| `/api/auth/collab` | POST | `{ action: "reset-verify", email, token, password }` | `{ ok }` — verifies the code, sets the new password, signs in |

Needs `NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` (else `501`). Requires the Supabase
email templates ("Confirm signup", "Magic Link", "Reset Password") to expose
`{{ .Token }}`, or no code is sent.

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

Blocked by `READ_ONLY=1` like the generate routes. Success is confirmed by
re-reading `auth status`, not by the login process's exit code.

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
