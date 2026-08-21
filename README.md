# Notecom

Turn lecture slides and PDFs into clear, plain-language study notes — read,
searched, and shared with classmates, in a code-editor-style reader.

Content is written by **Claude Code** (`/lect`, `/quiz`), grounded strictly in
the file you give it. The app itself only reads, organizes, and shares what
Claude Code writes — see [SPECIFICATION.md](SPECIFICATION.md) for the full
layer contract.

---

## Two ways to run it

Both read, search, and share the exact same notes — they're the same app
pointed at the same Supabase project. The difference is generation: writing a
new note runs **your own Claude Code CLI, on your own Claude subscription**,
which only works on the machine that CLI is installed and signed in on.

### Web app — [notecom.wyco-dev.com](https://notecom.wyco-dev.com)

Sign in and use it straight from the browser. No install.

- Browse folders, read notes and quizzes
- Full-text search across every note you can read
- Share folders with classmates, manage roles and join requests
- **Read-only badge** in place of the upload button — this host has no
  Claude Code CLI of its own, so it can't generate

### Desktop app — [download the installer](https://github.com/Wyco68/Notecom/releases/latest)

Everything the web app does, plus generation. Grab the installer for your OS
from the latest release (Windows `.exe`/`.msi`, macOS `.dmg`, Linux
`.AppImage`/`.deb`) and run it — no terminal needed afterward.

- Everything the web app has
- **Generate from a file** — drop in a lecture PDF or slide deck, get a note
  or quiz back, from inside the app

A new installer is published automatically for every tagged release —
[.github/workflows/release.yml](.github/workflows/release.yml). Older
versions stay downloadable on their own release pages; nothing gets
overwritten.

---

## What generation needs

- A **Claude subscription** ([claude.ai](https://claude.ai)) — generation
  runs on it directly, at no extra cost, no API key
- The **Claude Code CLI**, installed and signed in once:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude
  ```

That's it on the desktop app — the installer bundles everything else `/lect`
and `/quiz` need. Prefer a terminal instead of the app? Type `/lect Wireless
Network` (or `/quiz ...`) after dragging a file into `claude`; either path
lands in the same place.

---

## Signing in

Email + password, plus an 8-digit code sent to that email — both required,
every time. "Forgot password?" sends a reset link; open it in the same
browser you asked from.

---

## Sharing

Folders are the unit of sharing, not individual notes. Every folder starts
**private**; you decide who else sees it:

- **Public** means *listed* — others can find it and ask to join, never that
  it's readable without joining.
- **Invite** people who follow you directly, or approve **join requests**.
- **Roles**: viewer reads, editor reads and writes, owner is you.
- **Tags** group people — give a folder a tag like `ISNE3RD` and everyone
  with that tag gets it, all at once.

---

## Building it yourself

```bash
git clone https://github.com/Wyco68/Notecom.git
cd Notecom
npm install
npm run dev              # http://localhost:3000 — browser only
npm run dev:desktop      # native window, needs Rust (hot reload)
npm run install:desktop  # builds and opens your own installer
```

Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in
`.env.local` — there is no local-only mode, Supabase is the store from the
first request. Full setup with prerequisites:
[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

| Document | What's in it |
|---|---|
| [docs/how-it-works.md](docs/how-it-works.md) | Plain-language walkthrough, with diagrams |
| [SPECIFICATION.md](SPECIFICATION.md) | The layer contract, end to end |
| [flow.md](flow.md) | Request-by-request data flow |
| [docs/architecture.md](docs/architecture.md) | Data flow, and the rules that must not break |
| [docs/desktop.md](docs/desktop.md) | The Tauri shell and the release pipeline |
| [docs/deploy-vps.md](docs/deploy-vps.md) | Hosting the web app yourself |
| [docs/api-contract.md](docs/api-contract.md) | Every endpoint |
| [docs/collaboration.md](docs/collaboration.md) | Sharing model and Row Level Security |

No AI SDK in the app, no Anthropic API key, no service-role key anywhere —
generation is a local CLI subprocess, and every table is protected by
Supabase RLS.

## License

No license file is currently published — all rights reserved by default
until one is added.
