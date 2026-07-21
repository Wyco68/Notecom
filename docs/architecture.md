# Architecture

Loaded by `/feat` only. Canonical docs (kept at repo root, not
duplicated here — read both before any architecture-affecting change):

- [SPECIFICATION.md](../SPECIFICATION.md) — the two-layer contract
  (Next.js reads and manages / Go helper is dumb filesystem I/O).
  Claude Code is the author but is not a layer inside the app.
- [flow.md](../flow.md) — concrete request-by-request data flow:
  lesson creation (Claude Code → vault/), viewing, folder/lesson management.
- [docs/desktop.md](desktop.md) — the Tauri shell (`desktop/`): startup
  orchestration, splash screen, dev vs production sidecar layout.
Multi-device is cross-device sync, not a hosted reader: each machine runs
the desktop app and the `stored` sidecar reconciles its SQLite database with
Supabase in the background (see "Primary datastore" below). The former
read-only cloud reader channels (`VAULT_SOURCE=gcs`/`worker`) were retired
in favour of this — see git history for their setup docs.

## The one rule that must never break

Don't move logic across the layers when fixing or extending the app:

- Don't add naming/slug/sequence logic to the Go helper (`tools/vaultd/`)
  — that's Next.js's job (`lib/vault/slug.ts`).
- Don't add persistence to a React component or API route directly —
  always through `lib/vault/helper.ts` → `stored` (which mirrors to the
  filesystem via `vaultd`). Never fetch Supabase from the app; sync lives
  only inside `stored`.
- Don't add any AI generation logic or Anthropic API calls to the Next.js
  app. Two delegations are the sanctioned exception (2026-07): the chat
  proxy (`/api/chat` → indexd `/chat` → local Ollama) and the generation
  job runner (`lib/generate/runner.ts` spawns the local Claude Code CLI to
  run `/lect`/`/quiz`). The app orchestrates; it never implements
  generation, never embeds, never stores an API key.
- Don't add business logic to `desktop/` (the Tauri shell). It only
  starts/stops vaultd and Next, shows the splash/main window, and cleans up
  on exit — it has no opinion on vault content, naming, or UI.
- Don't add chunking, embedding, or ranking logic to vaultd or to Next.js
  — search/retrieval intelligence lives only in `indexd` (below).

## Primary datastore: stored (`tools/stored/`)

A third Go service (default `127.0.0.1:4323`) that owns the app's live
SQLite database (`<vault>/.data/notes.db`) and the Supabase sync engine.
Since the offline-first migration (2026-07) it — not the filesystem — is the
source of truth while the app runs:

- The Next.js helpers (`lib/vault/helper.ts`) read and write **stored**
  over the same wire contract vaultd had; only the base URL changed.
- Every mutation commits atomically with one `sync_queue` row; a background
  worker inside stored reconciles with Supabase every 30s (batched upserts,
  tombstone deletes, Last-Write-Wins by `version` with `updated_at`
  tiebreak, exponential backoff). UI code never uploads anything.
- After every DB mutation stored **mirrors the change to `vault/` by
  calling vaultd**, so the legacy file tree stays a live export: indexd
  keeps indexing files, Claude Code keeps writing files, and a vault import
  (`POST /import`, awaited by `/api/tree`) ingests Claude-authored files
  back into SQLite.
- Supabase credentials live in `<vault>/.data/sync.env`
  (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`); without them stored runs fully
  local and just logs that sync is disabled. The remote `notes_folders` /
  `notes_documents` tables have RLS enabled with no policies — only the
  service role (this worker) can touch them.

Endpoints: [api-contract.md](api-contract.md). Division of responsibility:
vaultd stays dumb filesystem I/O, indexd stays search-only, stored owns
persistence + sync and holds **no** naming/slug/seq logic — every value it
stores arrives fully resolved from the app, same rule as vaultd.

## Search layer: indexd (`tools/indexd/`)

A second Go service (default `127.0.0.1:4322`) that turns the vault into a
searchable knowledge base — the RAG backend. It chunks lesson HTML by
educational sections (h2/h3), embeds chunks via a local Ollama server when
one is available, and serves hybrid retrieval (SQLite FTS5 keyword + vector
cosine, merged with reciprocal-rank fusion).

Division of responsibility, in one line each:
- **vaultd** stays dumb filesystem I/O — it knows nothing about search.
- **indexd** owns all indexing/retrieval intelligence and its own storage:
  one SQLite file at `vault/.index/index.db` (metadata + FTS5 + embedding
  BLOBs). Derived data — deleting it is safe; a reindex rebuilds it.
- **Next.js** only proxies queries (`/api/search`, `/api/related/...` →
  `lib/search/indexd.ts`) and never chunks or embeds anything.
- **Claude Code** can query indexd over HTTP to retrieve only the relevant
  sections of a lesson instead of whole files (token reduction).

Freshness: indexd scans on startup and on `POST /reindex`; the Next.js
`/api/tree` route fire-and-forgets a reindex on every tree fetch (page
load, window focus, refresh button), so the index follows vault changes
without a file watcher. Scans are hash-based and near-free when nothing
changed.

Degradation is by design: without Ollama (not installed / not running),
indexing and FTS5 keyword search work fully; vector search activates and
backfills automatically once Ollama + the embedding model
(`nomic-embed-text`) appear. Endpoints: [api-contract.md](api-contract.md).
