# Getting started

Everything lives in this repo: the app, the `/lect` `/quiz` `/assignment`
commands, the teaching templates, and your notes (`vault/`). Setup is:
clone, install, run one setup command, log in to Claude once.

## 1. Install the base tools

| Tool | Why | Install |
|---|---|---|
| **Node.js 20+** | runs the app | [nodejs.org](https://nodejs.org) |
| **Go 1.21+** | builds the two backend services | [go.dev/dl](https://go.dev/dl) |
| **Python 3 + pip** | file conversion for `/lect` | [python.org](https://python.org) (often preinstalled on macOS/Linux) |
| **Git** | clone the repo | [git-scm.com](https://git-scm.com) |

## 2. Clone and set up

```bash
git clone <this-repo-url>
cd university-notes
npm install
npm run setup
```

`npm run setup` checks every tool, installs the file-conversion helper
(`markitdown-mcp`), builds both backend services, and prints exactly what's
left to do by hand. Re-run it any time — it's a checklist, not a one-shot.

## 3. Install and log in to Claude Code (once)

```bash
npm install -g @anthropic-ai/claude-code
claude
```

`claude` opens a browser to sign in with your Claude account (Pro/Max
subscription or Console API key). After that, this project's commands drive
it for you.

## 4. Write your first note

From the project folder:

```bash
claude
```

Attach a slide deck or PDF (drag it into the conversation), then type:

```
/lect Wireless Network
```

("Wireless Network" is the subject folder — reuse the same name to add more
lessons to that subject.) Claude converts the file, writes a plain-language
lesson, and saves it under `vault/`.

## 5. Read your notes

```bash
npm run dev
```

Open `http://localhost:3000/vault`. Or, for a native desktop window instead
of a browser tab:

```bash
npm run dev:desktop        # needs Rust — see docs/desktop.md
```

Both read the same `vault/` folder `/lect` writes into — new notes show up
as soon as they're generated (there's a refresh button next to the theme
toggle). There is **one** vault: this checkout's. Every way of running the
app uses it.

## 6. Optional extras

- **Ask My Notes chat + semantic search** — install
  [Ollama](https://ollama.com), then:
  ```bash
  ollama pull llama3.2
  ollama pull nomic-embed-text
  ```
  Chat and smarter search switch on automatically. Everything runs locally;
  nothing leaves your machine. Without Ollama, keyword search still works
  and the chat button tells you what's missing.
- **`/quiz <Subject>`** — turn questions into a saved quiz.
- **`/assignment`** — work through a university programming assignment with
  a permanent learning journal saved next to your notes.
- **Generate button in the app** — same as `/lect`/`/quiz`, but from an
  upload dialog inside the reader. Uses your local Claude Code login.
- **Installable desktop build** — `npm run install:desktop` produces a
  native installer for *this machine* so you can launch LectureLens from the
  Start Menu / Applications without a terminal. It still reads this
  checkout's `vault/`. See [desktop.md](desktop.md).

## Troubleshooting

- **`claude: command not found`** — reopen your terminal after the global
  npm install, or check `npm root -g` is on PATH.
- **`/lect` says markitdown isn't connected** — `pip install markitdown-mcp`
  (or re-run `npm run setup`), then start a fresh `claude` session.
- **App shows no notes** — confirm `vault/<Subject>/` folders exist in this
  checkout; if you have several checkouts, make sure you're running the app
  from the one `/lect` wrote into. All run modes read this checkout's
  `vault/` — there is no second notes location.
- **Search/chat offline message** — `npm run dev` starts both backend
  services automatically; if one died, re-run `npm run dev` (or
  `node scripts/ensure-vaultd.mjs` / `node scripts/ensure-indexd.mjs`).
