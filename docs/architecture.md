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
3. `lib/generate/save.ts` closes any numbering gap, then names it
   (`<seq>-<slug>`, seq from what the folder already holds in Supabase) and
   writes it through `saveDoc`.

The upload is the one file on disk, in the OS temp dir, deleted when the run
ends — the CLI needs a path to read it from.

An old binary Office upload (`.ppt`, `.doc`, `.xls`) is converted to its XML
successor first (`lib/generate/convert.ts`), since markitdown reads only those.
The converter is the machine's own LibreOffice, run headless in a throwaway
folder under the home directory (the snap build cannot see `/tmp`); without
LibreOffice the upload is refused before the run, saying to save it as
`.pptx`/`.docx`/`.xlsx` or PDF. Cheatsheet slides go through the same step.

## Cheatsheets: stored, built in steps that save as they go (2026-10)

`/sheet` is a third generation run, started from the sidebar's Cheatsheet
dialog with a folder, a first and last chapter, and a page limit (or none).
A sheet is a document of `kind = 'sheet'` in that folder, so it shares,
lists, renames and deletes like a lesson, under the same folder policies; its
spec (range, page limit, added sources), the app's check results, its
per-chapter review, the chapters still to write and its conversation live in
`notes_documents.meta` (migration 0032). It has no search chunks: it restates
lessons already indexed.

**Steps, not one long run.** A sheet used to be written, checked, reviewed and
fixed in one run, and a usage limit near the end lost all of it. Now
`lib/generate/sheet.ts` runs three kinds of step, each saving before the next
part costs anything:

- **write**: one chapter per CLI run (chapter mode), each with its share of
  the budget by how long its notes are. The sheet is saved after every
  chapter — the first save creates it, so it can be opened and saved as a PDF
  from then on — and a write that stops leaves `meta.pending`, which
  "Continue writing" (`POST /api/sheets/…/continue`) picks up.
- **edit**: one run over the whole sheet, from the chat box, the "fix these"
  buttons (their findings sent as a message) or "Add sources"
  (`…/sources`: folder documents, kept with the sheet, and uploads, used
  once).
- **review**: a fresh session per chapter checks that chapter's section
  against its sources (`…/review`); each chapter's findings are saved as they
  come, and an edit that changes a chapter clears its review.

Saving needs the reader's session, so a step that has something to save goes
`ready` and waits; the client's `POST /api/generate/[id]` saves it through
`saveSheetVersion` (`save.ts`, which reads the stored meta at save time and
applies the step's change) and, when there is more, sets the job running
again and answers `continued`, and the client follows on. Every step reads
its sources afresh as the caller (`lib/sheet/inputs.ts`): chapters, added
documents and uploads go to a temp dir as files; the CLI has no database
access. Each needs folder write access, and one step runs per sheet at a time.

**What blocks a save, and what doesn't.** Only markup outside the allowlist
(`sheetMarkupIssues`) is never saved. Everything else the app checks —
wording, chapter headings, numbers not in the sources (`lib/sheet/sources.ts`),
length — gets up to two fix rounds inside the run, then is saved with the
sheet as `meta.checks` for the reader to send back. Writing and review run on
Opus 5.5 (`SHEET_MODEL`, default `claude-opus-5-5`; `SHEET_EFFORT`, default
`high`; no fallback).

**Layout.** The browser lays the fragment into pages
(`lib/sheet/layout.ts`, `lib/sheet/paginate.ts`): A4 landscape for one or two
pages, portrait for more or none. For a page-limited sheet `lib/sheet/fit.ts`
tries 2 to 8 columns and, for each, the largest font that still fits the
limit; the largest readable font wins, which is also what fills the pages,
and a close runner-up replaces it if the winner has layout problems. Only a
sheet with no page limit has reader-chosen columns. `auditLayout` then checks
every box stays in its column, nothing overlaps or is cut off, and no heading
is stranded. The look follows the reader's reference sheet: navy headings
under a red chapter bar, navy table heads with striped rows, blue, teal,
pink and violet boxes, green code.

The preview iframe is sandboxed with no scripts; the view reaches in from the
parent to paginate and print. Model-written HTML never runs in the app's
origin.

**Save PDF is the one file the app writes** outside a run's temp dir, and it
is narrow on purpose (`lib/sheet/pdf.ts`): a user-asked export of a sheet the
caller can read, printed with the font and columns the browser fitted, named by the server, written without overwriting into the
Downloads folder of the machine the server runs on — and only where the
Claude Code CLI is installed, the app's signal for "the reader's own
machine"; a hosted server falls back to the print dialog. It prints
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
