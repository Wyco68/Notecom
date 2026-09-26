# Data Flow — Next.js + Supabase

Two separate workflows: **lesson creation** (Claude Code authors, the app
files) and **lesson reading/management** (the Next.js app). Both end in
Supabase — the source of truth. Nothing is written to local disk.

---

## 1. Lesson creation (Generate → Claude Code → app → Supabase)

Claude Code is the only tool that authors lesson content; the app is the only
thing that saves it.

```
Generate dialog (folder + file)
  → POST /api/generate            upload to OS temp, spawn the CLI (read-only)
  → /lect or /quiz (Claude Code)
      reads the upload, converts it with markitdown
      generates semantic HTML, grounded strictly in that source
      replies with the HTML — it has no tool that can write
  → lib/generate/validate.ts      contract check; violations go back to the
                                  same session to fix (at most twice)
  → job "ready", HTML in memory   upload deleted
  → POST /api/generate/[id]       the client, as soon as the tail ends
  → lib/generate/save.ts          seq = max in folder + 1, id = <seq>-<slug>
  → saveDoc()                     notes_documents + search chunks, under RLS
  → Done — the tree re-reads
```

The CLI's tools are `Read` and the markitdown converter, with
`--permission-mode dontAsk`, so anything else is refused rather than prompted.
The save is a separate request because it runs as the signed-in user, and only
a request carries that session.

**Naming (the app's, `lib/generate/save.ts`):**
- `<id>` = `<seq padded to 2 digits>-<slug>`, e.g. `03-routing-protocols`
- `<slug>` = the `<h1>` title lowercased, non-alphanumerics → `-`, trimmed
- `<seq>` = max existing seq of that kind in the folder + 1

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
  │  listFolders()
  ▼
Supabase
  │  RLS-scoped select over notes_folders
  │  → { folders: [{ name }] }
  ▼
AppShell renders the sidebar's folder list

  │  (behind it) POST /api/tree
  │     reindexStale()   (re-chunk anything indexed at an older version)
  │     → re-reads the tree only if it changed something

  │  user opens a folder
  ▼
GET /api/folders/<Folder>
  │  listFolderDocs()  (RLS-scoped select over notes_documents)
  │  → { lessons: [...], quizzes: [...] }
  ▼
FileTreeNode replaces its placeholder rows with the documents

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

Index freshness: `POST /api/tree` (once the tree is on screen, when a generation
run finishes, and on the refresh button) runs `reindexStale()`, which re-chunks
any document whose chunk rows are missing or were built from an older `version`
— typically one written by another device. It is a POST, and behind the tree
rather than in front of it, because it used to run on every page load and every
window focus, ahead of the first thing the reader was waiting for.

---

## 7. Who does what

| Layer | Files | Responsibility |
|---|---|---|
| **Claude Code** | `/lect`, `/quiz` commands | Content creation: generate HTML and reply with it. Writes nothing |
| **Generation** | `lib/generate/*` | Run the CLI read-only, check the contract, name and save the result |
| **Next.js routes** | `app/api/*` | Turn HTTP into data-layer calls and errors into `{ error }`. No permission logic |
| **Data layer** | `lib/vault/store.ts` | All content persistence. Zero permission logic |
| **Search** | `lib/search/chunker.ts`, `lib/search/search.ts` | Split lessons into sections; forward queries. Ranking lives in SQL |
| **Supabase** | `supabase/migrations/*` | The source of truth, and the authorization boundary (RLS) |
