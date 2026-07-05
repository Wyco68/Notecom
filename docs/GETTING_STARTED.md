# Getting started with Claude Code (for new contributors)

This project's notes are written by **Claude Code**, not by the app itself
(see [SPECIFICATION.md](../SPECIFICATION.md)). This guide sets up Claude
Code from nothing and walks through generating your first note. It assumes
no prior Claude Code experience.

If you only want to *read* notes someone else already generated, you don't
need any of this — see [INSTALL.md](INSTALL.md) instead.

## 1. Install prerequisites

| Tool | Why | Install |
|---|---|---|
| **Node.js 20+** | runs the web app | [nodejs.org](https://nodejs.org) |
| **Go 1.21+** | builds the two backend services | [go.dev/dl](https://go.dev/dl) |
| **Python 3 + pip** | runs the file-conversion tool `/lect` needs | [python.org](https://python.org) (usually already on macOS/Linux) |
| **Git** | clone the repo | [git-scm.com](https://git-scm.com) |

Rust and the Tauri build tools are only needed if you're building the
desktop *installer* yourself — see [desktop.md](desktop.md). You don't need
them just to write notes.

## 2. Install Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Then sign in once:

```bash
claude
```

This opens a browser to log in with your Claude account (Pro, Max, or a
Console API key all work). Once it says you're logged in, close it — you
won't need the interactive `claude` command directly, the project's `/lect`
etc. commands drive it for you.

## 3. Install the file-conversion tool

`/lect` reads slides/PDFs/images by converting them to Markdown first, via a
small tool called `markitdown-mcp`:

```bash
pip install markitdown-mcp
```

The project's [.mcp.json](../.mcp.json) already tells Claude Code to use it
— nothing else to configure.

## 4. Clone the project and install dependencies

```bash
git clone <this-repo-url>
cd university-notes
npm install
```

This is now **your** checkout — your notes will live in `vault/` inside it,
and it's the one place Claude Code and the app both look.

## 5. Write your first note

Open a terminal in the project folder and start Claude Code:

```bash
claude
```

Attach a slide deck or PDF to the conversation (drag the file in, or use
your editor's attach button), then type:

```
/lect Wireless Network
```

("Wireless Network" is the subject folder — reuse it for more lessons on the
same subject, or use a new name to start a new one.) Claude converts the
file, writes a plain-language lesson, and saves it under `vault/`.

## 6. See it in the app

While you're actively writing notes, run:

```bash
npm run dev:desktop
```

This opens the app pointed at your checkout's `vault/` — the exact folder
`/lect` just wrote into — so new notes appear the moment you generate them.
(`npm run dev` + a browser at `http://localhost:3000/vault` works the same
way, without the native window.)

**Heads up about the installed app** (`npm run build:desktop` or a
downloaded installer): it stores notes in a separate per-user folder, not
your checkout's `vault/` (see [desktop.md](desktop.md) for why — installers
need to work on machines with no checkout at all). It copies your checkout's
notes in automatically **the first time** it runs on your machine, but after
that the two folders are independent — new notes from `/lect` won't appear
in the installed app until you rebuild/reinstall it. If you're actively
generating notes, use `npm run dev:desktop` above as your daily driver; treat
the installed app as the "finished, hand-it-to-someone" version.

## 7. Optional: quizzes, assignments, chat, search

- `/quiz <Subject>` — turn a question or a Markdown quiz file into a quiz
  saved next to your lessons.
- `/assignment` — clone and work through a university programming
  assignment, with a permanent learning-journal note generated alongside it.
- **Ask My Notes** (chat bubble, top-right of the reader) and **semantic
  search** run entirely on your machine via [Ollama](https://ollama.com) —
  see [INSTALL.md](INSTALL.md#4-optional-turn-on-the-ai-features) to turn
  them on. Neither is required to read or write notes.

## Troubleshooting

- **`claude: command not found`** — re-open your terminal after installing
  (PATH needs a refresh), or check `npm root -g` is on your PATH.
- **"markitdown isn't connected"** message from `/lect` — `markitdown-mcp`
  isn't installed or Claude Code needs a restart to pick up `.mcp.json`;
  re-run `pip install markitdown-mcp` and start a fresh `claude` session.
- **App shows no notes** — check you're looking in the right vault. Running
  `npm run dev:desktop` or `npm run dev`? You're seeing the checkout's
  `vault/` — confirm `/lect` actually wrote there (check the folder exists).
  Running the *installed* app? It only gets your checkout's notes on its
  first-ever launch on this machine — see step 6 above.
