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

## The one rule that must never break

Don't move logic across the layers when fixing or extending the app:

- Don't add naming/slug/sequence logic to the Go helper (`tools/vaultd/`)
  — that's Next.js's job (`lib/vault/slug.ts`).
- Don't add filesystem writes to a React component or API route directly
  — always through `lib/vault/helper.ts` → `vaultd`.
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
  sections of a lesson instead of whole files (token reduction), e.g. from
  `/assignment` lecture research.

Freshness: indexd scans on startup and on `POST /reindex`; the Next.js
`/api/tree` route fire-and-forgets a reindex on every tree fetch (page
load, window focus, refresh button), so the index follows vault changes
without a file watcher. Scans are hash-based and near-free when nothing
changed.

Degradation is by design: without Ollama (not installed / not running),
indexing and FTS5 keyword search work fully; vector search activates and
backfills automatically once Ollama + the embedding model
(`nomic-embed-text`) appear. Endpoints: [api-contract.md](api-contract.md).
