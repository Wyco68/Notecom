# Architecture

Loaded by `/feat` only. Canonical docs (kept at repo root, not
duplicated here — read both before any architecture-affecting change):

- [SPECIFICATION.md](../SPECIFICATION.md) — the layer contract: Claude Code
  authors content, the Next.js app reads and manages it. Claude Code is the
  author but is not a layer inside the app.
- [flow.md](../flow.md) — concrete request-by-request data flow:
  lesson creation, viewing, folder/lesson management.
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

Nothing is local, generated content included (2026-09). The `vault/`
directory Claude Code used to write lessons into — and `lib/vault/import.ts`,
which ingested it on the next tree load — are gone. A generation run now hands
its HTML back to the app, which checks it and saves it straight to Supabase
(below, "Generation").

## Generation: the CLI authors, the app files (2026-09)

`lib/generate/runner.ts` runs `/lect` or `/quiz` with **read-only tools**
(`--tools Read`, markitdown allowed, `--permission-mode dontAsk` — anything
else is refused, not prompted). The CLI cannot write a file, so "the app
saves" is a property of the run, not a request in the prompt. Its final reply
is the document. Then, in the app:

1. `lib/generate/validate.ts` checks it against the output contract. On a
   violation the runner resumes the same CLI session with the list (at most
   twice); nothing is saved until it passes.
2. The job ends `ready`, holding the HTML in memory. The client's
   `POST /api/generate/[id]` saves it — a request, because the save runs as
   the signed-in user under RLS and only a request carries that session.
3. `lib/generate/save.ts` names it (`<seq>-<slug>`, seq from what the folder
   already holds in Supabase) and writes it through `saveDoc`.

The upload is the one file on disk, in the OS temp dir, deleted when the run
ends — the CLI needs a path to read it from.

## Cheatsheets: printed, never saved (2026-10)

`/sheet` is a third generation run, started from the sidebar's Cheatsheet
dialog with a folder, a first and last chapter, and a page limit.

1. `POST /api/sheet` reads those lessons as the caller (RLS decides, as for
   any read) and writes them to a temp dir as files, one per chapter, with any
   uploaded slides beside them. The CLI has no database access, so it can only
   ever see what that request could read. The dir goes when the run ends.
2. `lib/generate/runner.ts` (`generateSheet`) runs `/sheet` with the same
   read-only tools, on Opus 5.5 at extra-high effort for both writing and
   review (`SHEET_MODEL`, default `claude-opus-5-5`, pinned by full id;
   `SHEET_EFFORT`, default `xhigh`; no fallback to another model). Every
   reply then has to pass, in order: the contract
   (`checkSheet` in `validate.ts`: tag, attribute and class allowlist, numbered
   chapter headings, banned wording, a coarse length cap); the source check
   (`lib/sheet/sources.ts`: every chapter present, every number found in the
   notes); and an independent review, a fresh CLI session in `/sheet` review
   mode that reads the sheet and the same sources and returns what is wrong,
   unsupported, unclear or missing as JSON. Any failure goes back to the
   writer's session; rounds and review passes are bounded, and findings still
   open when they run out are shown with the sheet, not dropped. The job ends
   `done` holding the fragment in memory. Nothing is saved: a sheet is a
   print-out, and the lesson contract forbids the styling it needs. The
   sources stay in the temp dir for six hours, for a revision.
3. The browser lays it out. `lib/sheet/layout.ts` owns the paper (two
   layouts, picked from the page limit) and the page document;
   `lib/sheet/paginate.ts` deals the fragment's blocks into fixed-size pages,
   shrinking the font to the layout's floor until it fits. Pages are counted
   exactly because each is its own box, and print gets one box per sheet of
   paper instead of a column flow each engine fragments differently.
4. `auditLayout` then checks the laid-out pages: every box inside its own
   column, no block over another, nothing cut off, diagram labels inside
   their diagram and not on each other, no heading stranded at a column foot
   (the paginator already pushes those over). The panel lists every check —
   the server's and the browser's — and only offers Print as the main action
   when all pass. Over the limit at the smallest font, or with layout
   problems, the reader can send it back (`POST /api/sheet/[id]`), which
   resumes the writer's session with the measurements and runs every check
   and the review again. A button, not automatic, because it spends tokens.

The preview iframe is sandboxed with no scripts; the panel reaches in from the
parent to paginate and print. Model-written HTML never runs in the app's
origin.

**Save PDF is the one file the app writes** outside a run's temp dir, and it
is narrow on purpose (`lib/sheet/pdf.ts`): a user-asked export of a sheet only
its owner can reach, named by the server, written without overwriting into the
Downloads folder of the machine the server runs on — which for a cheatsheet is
always the reader's own, since sheets only exist where the CLI does. It prints
with a Chromium-family browser already installed (Chrome, Chromium, Edge,
Brave; `SHEET_PDF_BROWSER` overrides) through the DevTools protocol, because
the `--print-to-pdf` switch hangs on some builds. The renderer has file access,
so its input is filtered twice: the pages must pass `checkSheetPages` (a
browser-faithful tokenizer, not a regex, against the sheet allowlist), and the
document they are printed in carries a policy that forbids every load. No
browser installed: the print dialog, with "Save as PDF".

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
- Don't write files — not from the app, and not from the generation run. A
  feature that wants to persist something wants a table; generated content
  reaches Supabase through `lib/generate/save.ts` only. The single exception
  is a cheatsheet's Save PDF, an export into the reader's Downloads folder
  (see "Cheatsheets" above) — not storage, and not a pattern to extend.
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
  numbers arrive fully resolved (`lib/vault/slug.ts`,
  `lib/generate/save.ts`); the database invents none of them.
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

Freshness: the stale-chunk reindex is `POST /api/tree`, fired by the client
once the tree is on screen and on the refresh button. It used to sit in front of
`GET /api/tree`, where every page load and every window focus paid for a scan of
every document's chunk version before the sidebar could draw. It may not take
the tree down with it, and window focus re-reads the tree only. A generated
document needs no reindex — `saveDoc` writes its chunks.

Endpoints: [api-contract.md](api-contract.md).
