# Project Specification — Notes

## 1. Purpose

Notes is a web-based lesson library. It presents clean, deeply-explained
study notes in a code-editor-style reader. Notes are written in plain high-school-level
language with technically correct terminology, aimed at an Information Systems &
Network Engineering program.

**Content creation happens entirely outside the web application.**
Claude Code (the CLI) is the author. The Next.js app is the reader.

---

## 2. Architecture

Independent layers, each with a single non-overlapping responsibility,
packaged inside a thin desktop shell (Tauri — see
[docs/desktop.md](docs/desktop.md)). The shell only starts/stops the others
and shows the window; it holds no business logic and isn't a layer in the
sense below.

### 2.1 Next.js application — read and manage

- Application UI (sidebar, lesson reader, modals)
- Folder management (create, rename, delete, list)
- Lesson management (rename, delete, list)
- Browsing and navigation
- Rendering lessons (HTML parsed into React via `HtmlRenderer`)
- Mermaid diagram rendering, syntax highlighting

The Next.js app **contains no generation logic of its own**. Two narrow,
deliberate delegations exist (added 2026-07):

- ~~Ask My Notes~~ — the chat panel and its local model were removed; the
  app searches, it does not converse. No
  data leaves the machine, context is capped at a handful of sections.
- **Generate from file** — an upload modal that spawns the *local Claude
  Code CLI* headlessly (`lib/generate/runner.ts`) to run the same `/lect` /
  `/quiz` commands used in a terminal, on the user's existing subscription.
  The app supplies the file path and shows the log; every generation rule
  still lives in the command files, not the app.

The app still never calls the Anthropic API directly, stores no API key,
and never writes vault content itself.

### 2.2 Data layer (`lib/vault/store.ts`) — persistence

Supabase is the store, reached directly as the signed-in user. There is no
local database, no sync worker and no per-instance state, so the desktop app, a
dev server and a VPS all see the same rows at the same time.

- `lib/vault/store.ts` is the whole persistence surface for content; nothing
  else writes `notes_folders` or `notes_documents`.
- Deletes are tombstones (`deleted = true`, `version + 1`), never row removal.
- It receives fully-resolved values only — no slugify logic, no sequence-number
  generation, no content logic. Naming stays in `lib/vault/slug.ts` and in the
  generated `index.json`.
- Authorization is Row Level Security, in the database. This layer contains no
  permission checks, and must not grow any.

Superseded (2026-07) an offline-first design in which three Go sidecars —
`vaultd` (files), `stored` (local SQLite + background Supabase sync) and
`indexd` (FTS5 search) — ran on every machine. They are removed from the repo.

### 2.3 Vault import (`lib/vault/import.ts`) — one direction only

Claude Code writes generated lessons to `vault/` as files. This reads them and
upserts them into Supabase on the next tree load. The app writes no files
anywhere; a box with no `vault/` directory simply has nothing to import.

### 2.4 Search — Postgres full-text

Lesson HTML is split into educational sections (`lib/search/chunker.ts`: every
`<h2>` a topic, every `<h3>` a chunk, leading content an "Overview") and stored
in `notes_doc_chunks` with a generated `tsvector`. Ranking is two SQL functions,
`notes_search_chunks` and `notes_related_docs`, both SECURITY INVOKER so RLS
decides what is searchable. The chunk table is derived data — it can be rebuilt
from `notes_documents.html` at any time. Nothing here generates content or calls
Claude. See [docs/architecture.md](docs/architecture.md) and
[docs/api-contract.md](docs/api-contract.md).

---

## 3. Claude Code — content creation (outside the app)

Claude Code is the sole author of lesson content.

**Responsibilities:**
- Read uploaded lecture files (slides, PDFs, images)
- Generate lesson HTML following the output contract
- Regenerate and improve existing lessons
- Save lesson files directly to `vault/`
- Maintain `index.json` for each folder

**How Claude Code saves a lesson:**

```
/lect
  → Claude reads uploaded file
  → Claude generates semantic HTML
  → Claude writes vault/<Folder>/<id>.html
  → Claude upserts vault/<Folder>/index.json
  → Done — app refreshes on next load
```

Claude Code writes files using its own file tools. It does not go through any
Next.js API route to create content. The app's own management operations
(delete, rename, list) go through `lib/vault/store.ts` to Supabase; the two
meet at the import step, never at a shared write path.

Claude must never:
- choose app-level folder names without following the slug format
- generate filesystem paths inconsistent with the storage model below
- write anything to `app/`, `components/`, or `lib/`

Claude returns **semantic HTML only** — never Markdown, never a file.
Allowed tags: `h1 h2 h3 p ul ol li table thead tbody tr td th pre code blockquote
strong em div class="mermaid"`. No inline styles, no `<style>`/`<script>`,
no custom classes other than `class="mermaid"`.

---

## 4. Storage model

**Supabase is the source of truth**: `notes_folders` and `notes_documents`,
with device-independent UUID ids, per-row `version` + `updated_at`, and
soft-delete tombstones. `notes_doc_chunks` holds the derived search index.

The file tree below is **generation output**, written only by Claude Code and
read only by the importer. It stays exactly:

```
vault/
  <folder-slug>/
    index.json                    -- ordered lesson/quiz index
    01-topic-slug.html            -- one lesson's generated HTML
    02-another-topic.html
    quiz-01-topic-quiz.html       -- one quiz's generated HTML
```

`index.json` shape:
```json
{
  "lessons": [{ "id": "01-topic-slug", "slug": "topic-slug", "title": "Topic", "seq": 1 }],
  "quizzes": []
}
```

Quiz files (`quiz-` prefix) share the folder with lessons but never collide,
and each array sequences its `id`/`seq` independently. A legacy bare-array
`index.json` (lessons only) — or the retired `{lessons,quizzes,assignments}`
shape — is read transparently and upgraded on the next save.

- `id` = `<seq padded to 2 digits>-<slug>`, e.g. `"01-introduction"`
- `slug` = lowercased, non-alphanumerics collapsed to `-`, leading/trailing `-` trimmed
- `seq` = 1-based integer, monotonically increasing within the folder

The `.html` file holds exactly the generated HTML. The app reads it verbatim.
Gitignored and portable — never committed.

---

## 5. UI

### Sidebar

```
Notes

Subjects             [+]
  <Folder 1>
  <Folder 2>
  ...
```

Clicking **+** opens a small modal with exactly one field:

```
Folder Name
[Create]
```

There is no auth UI. The header has a Generate button (upload a lecture
file → local Claude Code CLI runs `/lect` or `/quiz`) and a search box over
the indexed sections — see §2.1.

---

## 6. Viewing flow

```
browser -> GET /vault
   -> AppShell renders sidebar + content pane
   -> Sidebar calls GET /api/tree
        -> importVault() ingests Claude-authored vault files into Supabase
        -> reindexStale() re-chunks anything whose search index lags
        -> listTree() selects notes_folders + notes_documents (RLS-scoped)
        -> returns folders + lessons JSON
   -> user clicks a lesson
   -> LessonViewer calls GET /api/lesson/<Folder>/<id>
        -> loadDoc() selects notes_documents.html
        -> returns the HTML
   -> HtmlRenderer parses HTML into React elements
        (DOMParser walk — no dangerouslySetInnerHTML)
        blockquote callouts → <Callout>, div.mermaid → <Mermaid>
   -> Framer Motion animates the content swap
```

---

## 7. Data-layer interface

`lib/vault/store.ts`, called by the route handlers through the lesson/quiz
façade in `lib/vault/helper.ts`. Not HTTP — the internal service wire contract
this section used to specify is gone with the sidecars.

| Function | Returns |
|---|---|
| `listTree()` | `{ folders: [{ name, lessons: [...], quizzes: [...] }] }` |
| `createFolder(slug)` | `{ ok }` — idempotent; new folders start private |
| `deleteFolder(slug)` | `{ ok }` — tombstone, cascading to its documents |
| `loadDoc(folder, id, kind)` | `{ html, title }` |
| `saveDoc(input)` | `boolean` — false when nothing changed |
| `deleteDoc(folder, id, kind)` | `{ ok }` — tombstone |
| `renameDoc(folder, id, kind, title)` | `{ ok }` — title only |

Saving is the importer's path, not a user-facing one: content is created by
Claude Code as files and enters the database through `lib/vault/import.ts`. See
[docs/api-contract.md](docs/api-contract.md) for the HTTP routes.

---

## 8. Tech stack

| Layer | Technology | Role |
|-------|-----------|------|
| Framework | Next.js 15 (App Router) | Routing, UI, API route handlers |
| Language | TypeScript | All web code; strict mode |
| UI | React 18 | Sidebar, modals, lesson viewer |
| Styling | Tailwind CSS + `@tailwindcss/typography` | Dark code-editor look |
| Lesson rendering | `HtmlRenderer` (DOMParser walk) | HTML → React, no dangerouslySetInnerHTML |
| Code highlighting | `highlight.js` (client-side) | Syntax inside `<pre><code>` blocks |
| Diagrams | `mermaid` | Client-side SVG from `div.mermaid` blocks |
| Animation | `framer-motion` | Fade/slide on lesson switch |
| Datastore | Supabase Postgres (`notes_*` tables, RLS-enforced) | The source of truth: folders, documents, sharing, search index |
| Data layer | `lib/vault/store.ts` (user-scoped Supabase client) | Folder/document CRUD; no permission logic of its own |
| Search | Postgres full-text (`notes_doc_chunks` + two SQL functions) | Section chunking, keyword retrieval |
| Notes storage | `.html` + `index.json` under `vault/` | Generation output, imported once and never written back; gitignored |
| Desktop shell | Tauri (Rust) | Native window, startup orchestration, splash screen, packaging |

No AI SDK, no Anthropic API key. Generation =
local Claude Code CLI subprocess. No authentication.

---

## 9. Setup and running

Requires:

- [Node.js](https://nodejs.org/) 20+ and npm.
- [Rust](https://www.rust-lang.org/tools/install) + the platform C/C++ build
  tools Tauri needs (only to build/run the desktop shell).
- A Claude subscription (Pro/Max) and the [Claude Code](https://claude.com/claude-code)
  CLI, used to run the `/lect` note-writing command.

```bash
npm install
```

**Desktop app (recommended)** — see [docs/desktop.md](docs/desktop.md) for
full detail:

```bash
npm run dev:desktop     # development: native window, hot reload
npm run build:desktop   # production: installer under desktop/target/release/bundle
```

**Browser-only fallback** — no native window, one process:

```bash
npm run dev                 # http://localhost:3000 -> /vault
```

Either way the app needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`: that project *is* the store,
not an optional backup, so there is no fully-local mode any more.

Writing a note happens separately, via Claude Code in a terminal, using the
`/lect` command (see [CLAUDE.md](CLAUDE.md)) — not through the website.

---

## 10. Out of scope

- No offline mode — every read and write goes to Supabase as it happens. The
  local-SQLite-plus-background-sync design, and the earlier GCS/Cloudflare
  read-only reader channels, were both retired 2026-07; see git history.
- No anonymous access — collaboration requires a Supabase account, and
  `anon` is granted nothing on any `notes_*` table.
- No per-document permissions — folders are the unit of sharing and
  documents inherit them (see docs/collaboration.md).
- No generation *logic* inside the application — the app only delegates to
  the local Claude Code CLI (lessons/quizzes), which runs on the subscription of
  the person at that machine. No server-side generation, no shared API key, no
  relay serving several people from one subscription.
- No service-role key, anywhere. Every query carries the caller's JWT and is
  filtered by RLS; a task that seems to need the service key has a wrong policy.
