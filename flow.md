# Data Flow — Next.js + Go services (stored / vaultd / indexd)

Two separate workflows: **lesson creation** (Claude Code, outside the app) and
**lesson reading/management** (the Next.js app). They meet in `stored`'s
SQLite database — the source of truth — with `vault/` as the file-format
bridge between Claude Code and the database.

---

## 1. Lesson creation (Claude Code → vault/ → SQLite)

Claude Code is the only tool that writes lesson content.

```
/lect (Claude Code CLI)
  → Claude reads uploaded lecture file (PDF, image, slides)
  → Claude generates semantic HTML following the output contract,
    grounded strictly in that source (no invented content)
  → Claude writes vault/<Folder>/<id>.html
  → Claude upserts vault/<Folder>/index.json
  → Done
```

This happens entirely outside the Next.js process. On the next tree fetch
the app awaits `stored POST /import`, which ingests the new files into
SQLite (idempotent, disk-wins, never enqueues sync ops); the stored sync
worker then uploads the new records to Supabase in the background.

Strict generation: the saved file is what stored persists to SQLite and
syncs to Supabase, so it must be faithful to the lecture — the content comes
from the uploaded source, not the model's prior knowledge. The in-app
Generate button drives the same `/lect` (or `/quiz`) flow via
`lib/generate/runner.ts`, whose prompt pins the exact destination folder and
enforces that grounding (fail rather than fabricate if the source can't be
read). It never writes to storage directly — it only produces the vault
file, and the import path above does the rest.

**Naming convention (Claude Code must follow):**
- `<folder>` = kebab-case slug of the subject name, e.g. `computer-networks`
- `<id>` = `<seq padded to 2 digits>-<slug>`, e.g. `03-routing-protocols`
- `<slug>` = title lowercased, non-alphanumerics → `-`, trimmed
- `<seq>` = max existing seq in the folder + 1

**index.json shape:**
```json
[{ "id": "01-introduction", "slug": "introduction", "title": "Introduction", "seq": 1 }]
```

---

## 2. Viewing a lesson (browser → Next.js → stored)

```
Browser
  │  GET /vault (page load)
  ▼
AppShell
  │  fetch GET /api/tree
  ▼
app/api/tree/route.ts
  │  await stored POST /import   (ingest Claude-authored files)
  │  listTree() → stored GET /tree
  ▼
stored
  │  reads SQLite, returns { folders: [{ name, lessons: [...] }] }
  ▼
AppShell renders sidebar with folder/lesson tree

  │  user clicks a lesson
  ▼
LessonViewer
  │  fetch GET /api/lesson/<folder>/<id>
  ▼
app/api/lesson/[folder]/[id]/route.ts
  │  loadLesson() → stored GET /lesson/<folder>/<id>
  ▼
stored
  │  reads SQLite, returns { html, title }
  ▼
HtmlRenderer
  │  DOMParser walk → React elements
  │  blockquote callouts → <Callout>
  │  div.mermaid → <Mermaid> (lazy SVG render)
  ▼
Screen
```

---

## 3. Folder management (browser → Next.js → stored)

**Create folder:**
```
NewFolderModal
  → POST /api/folders { name }
  → slugify(name) → POST stored /folder { name: slug }
  → stored: SQLite insert + sync_queue row (one transaction)
  → stored mirrors to disk via vaultd (dir + empty index.json)
  → sidebar refreshes
```

**Delete folder:**
```
FileTreeNode (hover → trash icon)
  → ConfirmModal
  → DELETE /api/folders/<name>
  → stored: tombstone folder + its documents + sync_queue rows (one transaction)
  → stored mirrors to disk via vaultd (os.RemoveAll)
  → sidebar refreshes
```

---

## 4. Lesson management (browser → Next.js → stored)

**Delete lesson:**
```
FileTreeNode (hover → trash icon)
  → ConfirmModal
  → DELETE /api/lesson/<folder>/<id>
  → stored: tombstone row + sync_queue row; mirror removes .html + index entry
  → sidebar refreshes
```

**Rename lesson:**
```
(rename UI → POST /api/lesson/<folder>/<id> { newTitle })
  → stored: title updated, version bumped, sync_queue row; mirror updates index.json
  → (filename and id unchanged)
```

---

## 5. Cross-device sync (stored ⇄ Supabase, background)

```
every 30s / on start / final flush on exit
  │  pull: rows with synced_at > cursor  → LWW apply → SQLite → disk mirror
  ▼
stored sync worker
  │  push: drain sync_queue → read live rows → batched upserts (tombstones
  │        included) → remove queue rows (or retry with backoff)
  ▼
Supabase (notes_folders / notes_documents — service-role only)
```

Conflicts: Last-Write-Wins — higher `version` wins, `updated_at` breaks
ties, equal means same write (ignored). UI code never talks to Supabase.

---

## 6. Searching notes (browser → Next.js → indexd)

```
Sidebar search box (AppShell)
  │  debounced fetch GET /api/search?q=...
  ▼
app/api/search/route.ts
  │  search() → indexd GET /search?q=...
  ▼
indexd
  │  FTS5 keyword ranks + (if Ollama up) vector cosine ranks
  │  reciprocal-rank fusion → top chunks with metadata
  ▼
SearchResults renders heading/lesson/summary per hit
  │  click → onSelect(LessonRef) → LessonViewer loads the document
```

Index freshness: every `GET /api/tree` (page load, window focus, refresh
button) fire-and-forgets `POST /reindex` to indexd; the scan is hash-based
and skips unchanged files. indexd reads the disk mirror, which stored keeps
current — so search follows both local edits and pulled remote changes.

---

## 7. Who does what

| Layer | Files | Responsibility |
|---|---|---|
| **Claude Code** | `/lect` command | Content creation: generate HTML, write vault/ files, update index.json |
| **Next.js** | `app/api/*`, `lib/vault/*`, `lib/search/*`, `components/*` | Read and manage via stored; proxy search; never touches Supabase |
| **stored** | `tools/stored/*.go` | Source of truth (SQLite), sync queue + Supabase worker, vault import, disk mirror orchestration. Zero naming logic |
| **vaultd** | `tools/vaultd/main.go` | Pure filesystem I/O over HTTP (Claude Code saves; stored mirrors). Zero naming logic, zero content logic |
| **indexd** | `tools/indexd/*.go` | Chunking, embeddings (via Ollama), hybrid search over `vault/.index/index.db` |
