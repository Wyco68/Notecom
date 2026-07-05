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

Two layers, each with a single non-overlapping responsibility, packaged
inside a thin desktop shell (Tauri — see [docs/desktop.md](docs/desktop.md)).
The shell only starts/stops the other two and shows the window; it holds no
business logic and isn't a third layer in the sense below.

### 2.1 Next.js application — read and manage

- Application UI (sidebar, lesson reader, modals)
- Folder management (create, rename, delete, list)
- Lesson management (rename, delete, list)
- Browsing and navigation
- Rendering lessons (HTML parsed into React via `HtmlRenderer`)
- Mermaid diagram rendering, syntax highlighting

The Next.js app **contains no generation logic of its own**. Two narrow,
deliberate delegations exist (added 2026-07):

- **Ask My Notes** — a chat panel proxied to indexd's `/chat`, which answers
  from retrieved chunks via a *local Ollama model*. No Claude involved, no
  data leaves the machine, context is capped at a handful of sections.
- **Generate from file** — an upload modal that spawns the *local Claude
  Code CLI* headlessly (`lib/generate/runner.ts`) to run the same `/lect` /
  `/quiz` commands used in a terminal, on the user's existing subscription.
  The app supplies the file path and shows the log; every generation rule
  still lives in the command files, not the app.

The app still never calls the Anthropic API directly, stores no API key,
and never writes vault content itself.

### 2.2 Go helper (`vaultd`) — filesystem operations only

A small Go HTTP service exposing exactly six operations:

```
CreateFolder()
LoadLesson()
DeleteLesson()
RenameLesson()
ListTree()
DeleteFolder()
```

It receives fully-resolved names and paths and performs raw filesystem I/O.
It contains no slugify logic, no sequence-number generation, no content logic.

### 2.3 Go search service (`indexd`) — retrieval only

A second Go service (`tools/indexd/`, default `127.0.0.1:4322`) that makes
the vault searchable (the RAG backend): chunks lesson HTML by educational
sections, embeds chunks via local Ollama when available, and serves hybrid
search (SQLite FTS5 + vector cosine, RRF-merged). Its entire state is one
derived SQLite file, `vault/.index/index.db` — safe to delete, rebuilt by a
reindex. Without Ollama it runs in keyword-only mode. It never generates
content and never calls Claude. See
[docs/architecture.md](docs/architecture.md) and
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
Next.js API route to create content. The Go helper (`vaultd`) is still the
correct path for the app's management operations (delete, rename, list), but
Claude Code writes lesson files directly.

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

```
vault/
  <folder-slug>/
    index.json                    -- ordered lesson/quiz/assignment index
    01-topic-slug.html            -- one lesson's generated HTML
    02-another-topic.html
    quiz-01-topic-quiz.html       -- one quiz's generated HTML
    assignment-01-task.html       -- one assignment journal's HTML
```

`index.json` shape:
```json
{
  "lessons": [{ "id": "01-topic-slug", "slug": "topic-slug", "title": "Topic", "seq": 1 }],
  "quizzes": [],
  "assignments": []
}
```

Quiz files (`quiz-` prefix) and assignment journals (`assignment-` prefix)
share the folder with lessons but never collide, and each array sequences
its `id`/`seq` independently. A legacy bare-array `index.json` (lessons
only) is read transparently and upgraded on the next save.

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
file → local Claude Code CLI runs `/lect` or `/quiz`) and an Ask My Notes
chat toggle (local Ollama over retrieved sections) — see §2.1.

---

## 6. Viewing flow

```
browser -> GET /vault
   -> AppShell renders sidebar + content pane
   -> Sidebar calls GET /api/tree
        -> Next.js calls vaultd ListTree()
        -> returns folders + lessons JSON (from each index.json)
   -> user clicks a lesson
   -> LessonViewer calls GET /api/lesson/<Folder>/<id>
        -> Next.js calls vaultd LoadLesson(folder, id)
        -> returns the stored HTML
   -> HtmlRenderer parses HTML into React elements
        (DOMParser walk — no dangerouslySetInnerHTML)
        blockquote callouts → <Callout>, div.mermaid → <Mermaid>
   -> Framer Motion animates the content swap
```

---

## 7. Go helper — interface

Runs on `localhost:4321`. Next.js API routes call it via `fetch` through
`lib/vault/helper.ts` only.

| Method | Path | Body in | Body out |
|--------|------|---------|----------|
| `POST` | `/folder` | `{ name }` | `{ ok }` |
| `DELETE` | `/folder/:name` | — | `{ ok }` |
| `GET` | `/lesson/:folder/:id` | — | `{ html, title }` |
| `DELETE` | `/lesson/:folder/:id` | — | `{ ok }` |
| `POST` | `/lesson/:folder/:id/rename` | `{ newTitle }` | `{ ok }` |
| `GET`/`DELETE`/`POST …/rename` | `/quiz/:folder/:id[…]` | — / `{ newTitle }` | mirrors `/lesson` for quizzes |
| `GET`/`DELETE`/`POST …/rename` | `/assignment/:folder/:id[…]` | — / `{ newTitle }` | mirrors `/lesson` for assignment journals |
| `GET` | `/tree` | — | `{ folders: [{ name, lessons: [...], quizzes: [...], assignments: [...] }] }` |

Note: `POST /lesson`, `POST /quiz`, and `POST /assignment` (save) are
implemented in vaultd and used by Claude Code (`/lect`, `/quiz`,
`/assignment`). See [docs/api-contract.md](docs/api-contract.md) for the
full endpoint list.

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
| Filesystem helper | Go HTTP service (`vaultd`) | Folder/lesson CRUD + tree listing |
| Search/RAG | Go HTTP service (`indexd`) + SQLite (FTS5 + vector BLOBs) | Section chunking, hybrid retrieval; Ollama embeddings when present |
| Notes storage | `.html` + `index.json` under `vault/` | Source of truth; gitignored |
| Desktop shell | Tauri (Rust) | Native window, startup orchestration, splash screen, packaging |

No AI SDK, no Anthropic API key. Chat = Ollama via indexd; generation =
local Claude Code CLI subprocess. No authentication.

---

## 9. Setup and running

Requires:

- [Node.js](https://nodejs.org/) 20+ and npm.
- [Go](https://go.dev/dl/) 1.21+ (only to build the filesystem helper).
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

**Browser-only fallback** — two manually-started processes, no native
window:

```bash
cd tools/vaultd && go build -o vaultd.exe . && cd ../..   # macOS/Linux: vaultd (no .exe)
./tools/vaultd/vaultd.exe   # filesystem helper, default :4321
node scripts/ensure-indexd.mjs   # search service, default :4322 (builds on first run)
npm run dev                 # http://localhost:3000 -> /vault
```

Semantic search (optional): install [Ollama](https://ollama.com) and run
`ollama pull nomic-embed-text`. Without it, search runs in keyword (FTS5)
mode; with it, indexd embeds automatically on the next scan.

Writing a note happens separately, via Claude Code in a terminal, using the
`/lect` command (see [CLAUDE.md](CLAUDE.md)) — not through the website.

---

## 10. Out of scope

- No database as source of truth (filesystem via Go helper is the store;
  indexd's SQLite file is derived search data only, safe to delete).
- No deployment/hosting beyond local dev.
- No multi-tenancy.
- No user authentication of any kind.
- No generation *logic* inside the application — the app only delegates to
  the local Claude Code CLI (lessons/quizzes) or local Ollama (chat).
