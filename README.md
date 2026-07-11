# LectureLens

Turns slides/PDFs into plain-language study notes, readable in a clean
code-editor-style reader. Works for any subject. The app, the note-writing
commands, the templates, and your notes all live in this one repo.

Content creation happens entirely outside the web app: **Claude Code** (the
CLI, on your own subscription) is the sole author of lesson/quiz/assignment
content. The Next.js app only reads, browses, and manages what's already in
`vault/` — see [SPECIFICATION.md](SPECIFICATION.md) for the full contract.

## Features

- Plain-language lesson notes generated from uploaded slides/PDFs/images
- Quiz + assignment-journal generation alongside lessons
- Hybrid search (keyword + semantic) and "Ask My Notes" chat over your own
  vault, fully local (Ollama) — nothing leaves your machine
- Native desktop app (Tauri) or plain browser tab — same `vault/`, your choice
- Optional read-only remote viewer (iPad/laptop access) with no code changes
  to the writer machine — see [Remote access](#remote-access-readonly)

## Quick start

```bash
git clone <this-repo-url>
cd university-notes
npm install
npm run setup
```

Then install Claude Code and log in once:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

Full walkthrough (tools, first note, optional AI extras):
**[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)**.

## Write a note

1. Open `claude` in this folder (or this repo in Claude Desktop / the VS
   Code extension).
2. Attach your slide/PDF.
3. Type:
   ```
   /lect Wireless Network
   ```
4. Claude writes the note and saves it to `vault/`.

## Read your notes

```bash
npm run dev            # browser: http://localhost:3000/vault
npm run dev:desktop    # native window (needs Rust — docs/desktop.md)
```

Prefer a Start-Menu app with no terminal? `npm run install:desktop` builds a
native installer for this machine — it reads the same `vault/` as everything
else.

## Make a quiz

```
/quiz Wireless Network — what's the difference between TDMA and FDMA?
```

Claude reasons through it, saves the answer next to your notes. Repeat
`/quiz` without a folder to keep appending to the same quiz.

## Change the app itself

Type a request starting with `/feat`, e.g.:
```
/feat add a delete button next to each lesson
```

**Rule:** lesson content → `/lect`. Quiz content → `/quiz`. University
assignments → `/assignment`. App/code → `/feat`. Never mix two of these in
one request.

## Remote access (read-only)

Want to browse your notes from an iPad or another laptop, without exposing
generation (which needs your local Claude Code CLI and can't run remotely)?
Run a second, read-only instance of the same app:

```bash
READ_ONLY=1 NEXT_PUBLIC_READ_ONLY=1 npm run build && npm run start
```

This hides Generate/New Folder in the UI and blocks every vault-mutating API
route at the middleware layer (`middleware.ts`) — 403 on anything but GET and
`/api/chat`. Point it at your vault via `VAULT_ROOT`, and if `vaultd`/`indexd`
are reachable over a public tunnel, set `VAULTD_TOKEN`/`INDEXD_TOKEN` (shared
secrets, both services reject requests without a matching `X-Auth-Token`
header once the env var is set — no-op for local-only setups). See
[Environment variables](#environment-variables) for the full list, and
`docs/desktop.md` for the underlying single-vault design this builds on.

## Updating after pulling changes

```bash
npm run setup          # rebuilds services if needed
npm run install:desktop   # only if you use the installed desktop app
```

## Environment variables

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `VAULT_ROOT` | vaultd, indexd | `./vault` | Vault directory both services read/write |
| `VAULTD_ADDR` | vaultd | `127.0.0.1:4321` | Listen address |
| `VAULTD_URL` | Next.js | `http://127.0.0.1:4321` | Where the app reaches vaultd |
| `VAULTD_TOKEN` | vaultd, Next.js | unset | Shared secret; vaultd requires `X-Auth-Token` on every request once set |
| `INDEXD_ADDR` | indexd | `127.0.0.1:4322` | Listen address |
| `INDEXD_URL` | Next.js | `http://127.0.0.1:4322` | Where the app reaches indexd |
| `INDEXD_TOKEN` | indexd, Next.js | unset | Shared secret, same behavior as `VAULTD_TOKEN` |
| `OLLAMA_URL` | indexd | `http://127.0.0.1:11434` | Local Ollama server for embeddings/chat |
| `EMBED_MODEL` | indexd | `nomic-embed-text` | Ollama embedding model |
| `CHAT_MODEL` | indexd | `llama3.2` | Ollama chat model for "Ask My Notes" |
| `READ_ONLY` | Next.js (server) | unset | `1` blocks all vault-mutating API routes |
| `NEXT_PUBLIC_READ_ONLY` | Next.js (client) | unset | `1` hides Generate/New Folder buttons in the UI |
| `REPO_ROOT` | Next.js | `process.cwd()` | Checkout path the packaged/standalone app runs the `claude` CLI from |
| `CLAUDE_BIN` | Next.js | `claude` | Override the Claude Code binary (tests substitute a stub) |
| `GENERATE_MODEL` | Next.js | `sonnet` | Model passed to `claude --model` for in-app generation |

## Tech stack

Next.js 15 (App Router) + React 18 + TypeScript, Tailwind CSS, two small Go
HTTP services (`vaultd` for filesystem CRUD, `indexd` for hybrid search/RAG
over SQLite FTS5 + vector BLOBs), Tauri for the desktop shell. No database as
source of truth, no Anthropic API key stored anywhere, no user accounts. Full
breakdown: [SPECIFICATION.md §8](SPECIFICATION.md#8-tech-stack).

---

Details: [SPECIFICATION.md](SPECIFICATION.md) (architecture),
[specification.json](specification.json) (machine-readable project spec),
[docs/desktop.md](docs/desktop.md) (desktop app internals),
[docs/api-contract.md](docs/api-contract.md) (full endpoint reference),
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) (full setup).
