# Architecture

Loaded by `/feat` only. Canonical docs (kept at repo root, not
duplicated here — read both before any architecture-affecting change):

- [SPECIFICATION.md](../SPECIFICATION.md) — the layer contract: Claude Code
  authors content, the Next.js app reads and manages it. Claude Code is the
  author but is not a layer inside the app.
- [flow.md](../flow.md) — concrete request-by-request data flow:
  lesson creation (Claude Code → vault/), viewing, folder/lesson management.
- [docs/desktop.md](desktop.md) — the Tauri shell (`desktop/`): startup
  orchestration, splash screen, dev vs production layout.

## Supabase is the store

Every read and write goes straight to Supabase as the signed-in user, on the
desktop app, in development and on a VPS alike. There is no local database, no
sync worker and no per-instance state: what a device shows is what the server
has.

This replaced (2026-07) an offline-first design in which each machine ran three
Go sidecars — `vaultd` (files), `stored` (a local SQLite source of truth plus a
background Supabase sync engine) and `indexd` (SQLite FTS5 search). They are
gone from the repo; read the git history if you need to know how they worked.
Three things went with them, all of them the point of the change: a device could
be a sync cycle behind, "which copy is right" was a real question, and every
deployment had to build and run a Go trio to show a lesson. The
`VAULT_SOURCE=gcs`/`worker`/`supabase` flags are retired too — there is one
source now, so there is nothing to select.

What remains local is `vault/`: the folder Claude Code writes generated lessons
into. The app only ever **reads** it — `lib/vault/import.ts` ingests those files
into Supabase on the next tree load. A box without a `vault/` directory (a VPS)
simply has nothing to import.

## No broad read-only mode — but a capability signal (2026-08)

The 2026-07 `READ_ONLY` / `NEXT_PUBLIC_READ_ONLY` flag, the middleware gate and
`/api/tree`'s `readOnly` field are still gone and stay gone — that was a
blanket write-lock from the old `stored`-sidecar architecture, where "local"
meant something. Every vault/folder/collab write now goes straight to
Supabase under RLS regardless of which machine sent it, so there is nothing
left for a server-wide write-lock to protect: a VPS can create folders, tag,
share and delete exactly as well as a desktop install.

Generate is the one exception, and the reason is unchanged: it spawns **that
user's own Claude Code CLI** on **their own subscription**
(`lib/generate/runner.ts`), so it only works on a machine with `claude` on
PATH. **Don't** add server-side generation, a shared API key, or a relay that
serves several people from one subscription: the first two mean per-token
charges on top of a subscription the user already pays for, and the third
breaks Anthropic's terms for consumer subscriptions.

What changed: that capability is now surfaced proactively instead of only
failing after the fact. `lib/auth/cli.ts`'s `cliInstalled()` (`claude
--version`, cached per process) feeds `installed` onto `GET /api/auth`, and
`POST /api/generate` rejects early (501) when it's false rather than after an
upload and a temp-file write. The client (`AppShell.tsx`) reads it to show a
plain "Read-only" badge in place of the Generate button — distinct from
"installed but logged out", which still offers sign-in. This is a read
of reality, not a toggle: there is no env var to flip it, and nothing else in
the app is gated by it.

## Access control

Folders are the unit of sharing (owner, members with roles, visibility,
discoverability, tags); documents inherit folder permissions. Enforcement lives
entirely in Postgres RLS — **no service-role key exists in this app**. Every
query runs through a user-scoped client (`lib/supabase/*`: anon key + the
caller's JWT), so the database decides what comes back and whether a write is
allowed. No route handler, data-layer function or React component re-checks
permissions; a second copy of the rules would only be a weaker one. Contract:
[collaboration.md](collaboration.md).

## The one rule that must never break

Don't move logic across the layers when fixing or extending the app:

- Don't add persistence to a React component or API route directly — always
  through `lib/vault/store.ts` (documents and folders) or `lib/collab/*`
  (membership, invitations, join requests, tags, folder search). Those two are
  the only places that touch the `notes_*` tables.
- Don't write files from the app. `vault/` is generation output, read by
  `lib/vault/import.ts` and never written back. A feature that wants to persist
  something wants a table.
- Don't add any AI generation logic or Anthropic API calls to the Next.js
  app. One delegation is the sanctioned exception (2026-07): the generation
  job runner (`lib/generate/runner.ts` spawns the local Claude Code CLI to
  run `/lect`/`/quiz`). The app orchestrates; it never implements
  generation and never stores an API key.
- Don't add business logic to `desktop/` (the Tauri shell). It only starts and
  stops the Next.js server, shows the splash/main window, and cleans up on exit
  — it has no opinion on content, naming, or UI.
- Don't add ranking logic to TypeScript. Retrieval belongs in SQL (below).

## Data layer: `lib/vault/store.ts`

The whole persistence surface, and small enough to read in one sitting:
`listFolders`, `listFolderDocs`, `createFolder`, `deleteFolder`, `loadDoc`,
`saveDoc`, `deleteDoc`, `renameDoc`. `lib/vault/helper.ts` sits on top purely to
translate the routes' lesson/quiz vocabulary into a document `kind`.

**The tree is read lazily.** `listFolders` returns names; a folder's documents
come from `listFolderDocs` when the reader opens it. The single `listTree` it
replaced fetched every readable document in the account on every page load,
window focus and refresh — a cost that grew with the whole vault to draw a list
of collapsed folder names.

Two rules it inherits from the sidecar it replaced:

- **Naming stays in the app.** Slugs, folder-local document keys and sequence
  numbers arrive fully resolved (`lib/vault/slug.ts`, the generated
  `index.json`); the database invents none of them.
- **Deletes are tombstones** — `deleted = true`, `version + 1`. A row that
  simply vanished would reappear the moment a client holding an older copy wrote
  anything, and the collaboration UI still needs to tell "removed" from "never
  existed".

Slugs are unique per owner, not globally (`notes_folders_owner_slug_key`), so
one slug can name several readable folders once folders are shared. Reads span
all of them; writes prefer the caller's own folder and let RLS settle the rest.

## Search: Postgres

Lesson HTML is split into educational sections — every `<h2>` opens a topic,
every `<h3>` a chunk inside it, content before the first heading becomes
"Overview". Fixed token windows would cut explanations mid-thought; heading
boundaries are how the lessons are actually taught.

- **Splitting** lives in `lib/search/chunker.ts`, because it reads the lesson
  HTML contract ([html-output-contract.md](html-output-contract.md)) — a content
  concern, not a database one. It needs no HTML parser: generated lessons are a
  flat fragment whose headings are never nested.
- **Storage** is `notes_doc_chunks` (migration `0015`), with a generated
  `tsvector` and a GIN index. Derived data: it can be rebuilt from
  `notes_documents.html` at any time, which `reindexStale()` does for anything
  written by another device.
- **Ranking** is two SQL functions, `notes_search_chunks` and
  `notes_related_docs`. Both are SECURITY INVOKER, so the chunk table's own
  SELECT policy decides what may be searched. `websearch_to_tsquery` ANDs bare
  words on purpose: with OR, one shared filler word ("how", "to") drags in dozens
  of unrelated chunks as soon as a query grows past two words.
- **Next.js** (`lib/search/search.ts`, `/api/search`, `/api/related/...`) only
  forwards the query and formats the answer.

Freshness: the vault import and the stale-chunk reindex are `POST /api/tree`,
fired by the client once the tree is on screen, again when a generation run
finishes, and on the refresh button. They used to sit in front of `GET
/api/tree`, where every page load and every window focus paid for a full scan of
`vault/` and of every document's chunk version before the sidebar could draw.
Neither may take the tree down with it, and window focus re-reads the tree only.

Endpoints: [api-contract.md](api-contract.md).
