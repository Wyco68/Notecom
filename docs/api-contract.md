# API Contract

Loaded by `/feat` only. Source of truth is the route files themselves
— this doc is a map, keep it in sync when routes change.

## Next.js API routes (`app/api/`)

| Route | Method | Body | Response |
|---|---|---|---|
| `/api/tree` | GET | — | `{ folders: [{ name, lessons: [{id,slug,title,seq}], quizzes: [...], assignments: [...] }] }` |
| `/api/folders` | POST | `{ name }` | `{ ok, folder }` — app slugifies `name` before calling vaultd |
| `/api/folders/[name]` | DELETE | — | `{ ok }` |
| `/api/lesson/[folder]/[id]` | GET | — | `{ html, title }` |
| `/api/lesson/[folder]/[id]` | DELETE | — | `{ ok }` |
| `/api/lesson/[folder]/[id]` | POST | `{ newTitle }` | `{ ok }` (rename) |
| `/api/quiz/[folder]/[id]` | GET | — | `{ html, title }` |
| `/api/quiz/[folder]/[id]` | DELETE | — | `{ ok }` |
| `/api/quiz/[folder]/[id]` | POST | `{ newTitle }` | `{ ok }` (rename) |
| `/api/assignment/[folder]/[id]` | GET | — | `{ html, title }` |
| `/api/assignment/[folder]/[id]` | DELETE | — | `{ ok }` |
| `/api/assignment/[folder]/[id]` | POST | `{ newTitle }` | `{ ok }` (rename) |
| `/api/search` | GET | `?q&folder&kind&limit` | `{ mode: "hybrid"\|"keyword", results: [chunk hits] }` — proxies indexd; on remote deployments (`VAULT_SOURCE=gcs`/`worker`) serves the prebuilt keyword index instead |
| `/api/related/[folder]/[id]` | GET | `?kind` | `{ results: [{folder,id,kind,title,score}] }` — proxies indexd |
| `/api/chat` | POST | `{ message, history }` | SSE passthrough of indexd `/chat` (sources → deltas → done) |
| `/api/generate` | POST | multipart `file, folder, kind(lect\|quiz)` | `{ jobId }` — saves upload, spawns local Claude Code CLI |
| `/api/generate/[id]` | GET | — | SSE job log (`line` events, then `end` with status) |

Error shape is always `{ error: string }` with a non-2xx status.

There are no auth routes. There is no lesson-, quiz-, or assignment-
generation route. Content creation happens via Claude Code (`/lect` for
lessons, `/quiz` for quizzes, `/assignment` for assignment journals), not
the web app.

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
| `/assignment` | POST | `{ folder, id, slug, title, seq, html }` | writes `assignment-{id}.html`, upserts `index.json`'s `assignments` array — used by Claude Code |
| `/assignment/{folder}/{id}` | GET | — | `{ html, title }` |
| `/assignment/{folder}/{id}` | DELETE | — | removes the `assignment-{id}.html` file + its index entry |
| `/assignment/{folder}/{id}/rename` | POST | `{ newTitle }` | index-only update |
| `/tree` | GET | — | `{ folders: [{ name, lessons: [...], quizzes: [...], assignments: [...] }] }` |

`index.json` holds `{ "lessons": [...], "quizzes": [...], "assignments":
[...] }`. Quiz and assignment files share a folder with lesson files but
never collide: quiz filenames carry a `quiz-` prefix and assignment
filenames an `assignment-` prefix on disk, and each of the three arrays has
its own independent `id`/`seq` sequencing. Older folders whose `index.json`
is still a bare array (lessons only, pre-quiz format) are read transparently
by vaultd and upgraded to the `{lessons,quizzes,assignments}` shape the next
time anything in that folder is saved.

Every name/id arriving at vaultd is already fully resolved by the caller.
`lib/vault/helper.ts` is the only TypeScript caller of these endpoints;
don't `fetch()` vaultd from anywhere else.

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

`kind` is `lesson` (default), `quiz`, or `assignment`. Search result chunk
shape: `{ folder, id, kind, title, topic, heading, summary, keywords, seq,
headingIndex, score, html? }` — `headingIndex` is the 0-based occurrence of
the heading text within its document (headings repeat), used by the viewer
to scroll to the matched section. Embeddings come from a local Ollama server
(`OLLAMA_URL`, model `EMBED_MODEL`, default `nomic-embed-text`); without
Ollama, `/search` serves `mode: "keyword"` (FTS5-only) and embeddings
backfill on a later scan.

## content-api (Cloudflare Worker, `workers/content-api`)

Serves a Workers KV mirror of the private GitHub `lecture-content` repo to
the `VAULT_SOURCE=worker` Vercel deployment. Every endpoint requires
`Authorization: Bearer <API_TOKEN>` except `/webhook`, which is instead
verified by its `X-Hub-Signature-256` HMAC (the `WEBHOOK_SECRET` secret).
`lib/vault/worker.ts` is the only TypeScript caller. Setup:
[deploy-cloudflare-github.md](deploy-cloudflare-github.md).

| Endpoint | Method | Body/params | Notes |
|---|---|---|---|
| `/tree` | GET | — | `{ folders: [{ name, lessons, quizzes, assignments }] }` — prebuilt at sync time |
| `/doc/{folder}/{id}` | GET | — | `{ html, title }` |
| `/search` | GET | `?q&limit` | `{ mode: "keyword", results: [...] }` — same scoring as the gcs mode (title +5, heading +3, body occurrence count); results cached in-Worker for 60s |
| `/status` | GET | — | `{ ok, commitSha, syncedAt, docCount }` |
| `/sync` | POST | — | forces a re-sync from GitHub, answers 202 |
| `/webhook` | POST | GitHub push payload | HMAC-verified; ignores non-push events and other branches; syncs async, answers 200 immediately |

Error shape is `{ error: string }` with a non-2xx status, matching the
Next.js routes.
