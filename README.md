# LectureLens

Turns slides/PDFs into plain-language study notes, readable in a clean
desktop app. Works for any subject. Everything — the app, the note-writing
commands, the templates, and your notes — lives in this one repo.

## Setup

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

**Rule:** lesson content → `/lect`. Quiz content → `/quiz`. App/code →
`/feat`. Never mix two of these in one request.

## Updating after pulling changes

```bash
npm run setup          # rebuilds services if needed
npm run install:desktop   # only if you use the installed desktop app
```

---

Details: [SPECIFICATION.md](SPECIFICATION.md) (architecture),
[docs/desktop.md](docs/desktop.md) (desktop app internals),
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) (full setup).
