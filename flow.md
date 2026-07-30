# Data Flow — Next.js + Supabase

Two separate workflows: **lesson creation** (Claude Code, outside the app) and
**lesson reading/management** (the Next.js app). They meet in Supabase — the
source of truth — with `vault/` as the one-way bridge that carries generated
files into it.

---

## 1. Lesson creation (Claude Code → vault/ → Supabase)

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

This happens entirely outside the Next.js process. On the next tree fetch the
app runs `importVault()` (`lib/vault/import.ts`), which upserts the new files
into Supabase and rebuilds their search chunks. Idempotent: a file identical to
the stored row is skipped, so a re-import churns no versions.

Strict generation: the saved file is what the importer persists, so it must be
faithful to the lecture — the content comes from the uploaded source, not the
model's prior knowledge. The in-app Generate button drives the same `/lect` (or
`/quiz`) flow via `lib/generate/runner.ts`, whose prompt pins the exact
destination folder and enforces that grounding (fail rather than fabricate if
the source can't be read). It never writes to storage directly — it only
produces the vault file, and the import path above does the rest.

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

## 2. Viewing a lesson (browser → Next.js → Supabase)

```
Browser
  │  GET /vault (page load)
  ▼
AppShell
  │  fetch GET /api/tree
  ▼
app/api/tree/route.ts
  │  importVault()    (ingest Claude-authored files, if any)
  │  reindexStale()   (re-chunk anything indexed at an older version)
  │  listTree()
  ▼
Supabase
  │  RLS-scoped select over notes_folders + notes_documents
  │  → { folders: [{ name, lessons: [...], quizzes: [...] }] }
  ▼
AppShell renders sidebar with folder/lesson tree

  │  user clicks a lesson
  ▼
LessonViewer
  │  fetch GET /api/lesson/<folder>/<id>
  ▼
app/api/lesson/[folder]/[id]/route.ts
  │  loadLesson() → loadDoc(folder, id, "lesson")
  ▼
Supabase
  │  notes_documents.html, or "not found" — which also covers
  │  "exists but you may not read it", deliberately
  ▼
HtmlRenderer
  │  DOMParser walk → React elements
  │  blockquote callouts → <Callout>
  │  div.mermaid → <Mermaid> (lazy SVG render)
  ▼
Screen
```

---

## 3. Folder management (browser → Next.js → Supabase)

**Create folder:**
```
NewFolderModal
  → POST /api/folders { name }
  → slugify(name) → createFolder(slug)
  → insert notes_folders (owner = caller, private, undiscoverable)
  → sidebar refreshes
```

**Delete folder:**
```
FileTreeNode (hover → trash icon)
  → ConfirmModal
  → DELETE /api/folders/<name>
  → tombstone the folder and each of its documents (deleted = true, version + 1)
  → sidebar refreshes
```

---

## 4. Lesson management (browser → Next.js → Supabase)

**Delete lesson:**
```
FileTreeNode (hover → trash icon)
  → ConfirmModal
  → DELETE /api/lesson/<folder>/<id>
  → tombstone the row; delete its chunks outright (a stale chunk would keep
    answering searches for text nobody can open)
  → sidebar refreshes
```

**Rename lesson:**
```
(rename UI → POST /api/lesson/<folder>/<id> { newTitle })
  → title updated, version bumped
  → (id, doc_key and slug unchanged — they are the document's identity)
```

---

## 5. Multiple devices

There is no sync step. Every device queries Supabase on each request, so a
change made on one is visible on the next load of another — the desktop app, a
dev server and the VPS are the same client pointed at the same database.

Writes are guarded by RLS, not by the app: a viewer's edit fails in Postgres,
which is the only place that can be trusted to refuse it.

---

## 6. Searching notes (browser → Next.js → Postgres)

```
Sidebar search box (AppShell)
  │  debounced fetch GET /api/search?q=...
  ▼
app/api/search/route.ts
  │  search() → rpc notes_search_chunks
  ▼
Postgres
  │  websearch_to_tsquery('simple', q) over notes_doc_chunks.search_tsv
  │  ts_rank → top chunks with their document + folder metadata
  ▼
SearchResults renders heading/lesson/summary per hit
  │  click → onSelect(LessonRef) → LessonViewer loads the document
```

Index freshness: `GET /api/tree` (page load, window focus, refresh button) runs
`reindexStale()`, which re-chunks any document whose chunk rows are missing or
were built from an older `version` — typically one written by another device.
Cheap when there is nothing to do.

---

## 7. Who does what

| Layer | Files | Responsibility |
|---|---|---|
| **Claude Code** | `/lect`, `/quiz` commands | Content creation: generate HTML, write vault/ files, update index.json |
| **Next.js routes** | `app/api/*` | Turn HTTP into data-layer calls and errors into `{ error }`. No permission logic |
| **Data layer** | `lib/vault/store.ts`, `lib/vault/import.ts` | All content persistence, and the one-way vault ingest. Zero permission logic |
| **Search** | `lib/search/chunker.ts`, `lib/search/search.ts` | Split lessons into sections; forward queries. Ranking lives in SQL |
| **Supabase** | `supabase/migrations/*` | The source of truth, and the authorization boundary (RLS) |
