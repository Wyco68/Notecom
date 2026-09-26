# Getting started

Everything lives in this repo: the app, the `/lect` `/quiz` commands and the
teaching templates. Your notes live in Supabase, per account. Setup is:
clone, install, run one setup command, log in to Claude once.

## 1. Install the base tools

| Tool | Why | Install |
|---|---|---|
| **Node.js 20+** | runs the app | [nodejs.org](https://nodejs.org) |
| **Python 3 + pip** | file conversion for `/lect` | [python.org](https://python.org) (often preinstalled on macOS/Linux) |
| **Git** | clone the repo | [git-scm.com](https://git-scm.com) |

## 2. Clone and set up

```bash
git clone <this-repo-url>
cd university-notes
npm install
npm run setup
```

Then point the app at your Supabase project — it is the store, so there is
no local-only mode and nothing works without it. Create `.env.local` in the
project folder with the two values from Supabase → Project Settings → API:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-KEY
```

The `NEXT_PUBLIC_` prefix is not decoration: it is the only prefix Next reads
into the app. A file that names them anything else (`VITE_*`, say) loads
fine and leaves every sign-in answering "accounts are not configured on this
server".

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

Start the app (step 5 below), sign in, create a subject folder (e.g.
"Wireless Network"), then click **Generate**, pick that folder and a slide
deck or PDF. The app runs `/lect` in your local Claude Code — read-only —
which converts the file and writes a plain-language lesson; the app checks
it against the lesson contract and saves it to your Supabase account.

## 5. Read your notes

```bash
npm run dev
```

Open `http://localhost:3000/vault`. Or, for a native desktop window instead
of a browser tab:

```bash
npm run dev:desktop        # needs Rust — see docs/desktop.md
```

Both read your notes from Supabase — new notes show up as soon as they're
generated (there's a refresh button next to the theme toggle). Nothing is
stored on this machine, so every way of running the app, on any device,
shows the same notes.

## 6. Optional extras

- **Quizzes** — pick "quiz" in the Generate dialog to turn a file of
  questions into a quiz.
- **Generate button in the app** — the way notes are made: it runs
  `/lect`/`/quiz` in your local Claude Code (read-only), checks the result
  and saves it to Supabase. Run in a terminal, `/lect` only prints the HTML
  — the app is what saves.
- **Installable desktop build** — `npm run install:desktop` produces a
  native installer for *this machine* so you can launch Notecom from the
  Start Menu / Applications without a terminal. See [desktop.md](desktop.md).

## Troubleshooting

- **`claude: command not found`** — reopen your terminal after the global
  npm install, or check `npm root -g` is on PATH.
- **Generate says markitdown isn't connected** — `uv tool install
  markitdown-mcp` (or `pip install markitdown-mcp`, or re-run `npm run
  setup`), so `markitdown-mcp` is on PATH, then generate again.
- **App shows no notes** — confirm you're signed in to the same account
  that generated them; notes live in Supabase, per account.
- **Search returns nothing** — a generated note is searchable as soon as it
  is saved; for notes made on another device, press the refresh button once
  (it re-indexes anything stale), then search again.
