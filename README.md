# Notecom

Turn lecture slides and PDFs into clear, plain-language study notes you can
read, search, and share with classmates.

You hand Notecom a lecture file. It writes the notes — in ordinary language,
with the technical terms kept correct — and files them under the subject they
belong to. Your notes live on your own machine and sync to your account, so
the same vault opens on your laptop and your phone.

![The reader](docs/images/web-app-vault.png)

---

## What you need

| | Why | Where |
|---|---|---|
| **Node.js 20+** | runs the app | [nodejs.org](https://nodejs.org) — pick the "LTS" download |
| **A Claude subscription** | writes the notes | [claude.ai](https://claude.ai) |
| **A Notecom account** | signing in, and sharing folders with classmates | created in the app, first run |

Nothing else is required. There is no API key to buy and no model to install:
the note-writing runs on the Claude subscription you already have, and search
runs entirely on your own machine.

---

## Install it once

Open a terminal in the folder where you keep projects, then run these four
lines. Copy them one at a time.

```bash
git clone <this-repo-url>
cd university-notes
npm install
npm run setup
```

`npm run setup` checks everything and prints a short list if something is
missing. Then install the note writer and sign in to it once:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

The first `claude` opens a browser window to log in. You only do this once.

Want a proper app with a Start Menu / Applications icon instead of a terminal?

```bash
npm run install:desktop
```

That builds an installer for this machine and opens the folder holding it. Run
it, and Notecom launches like any other program. (Takes a while the first time
— it compiles the desktop shell.)

Step-by-step version with screenshots:
**[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)**.

---

## Your first note

1. Open a terminal in this folder and type `claude`.
2. Drag your lecture slides or PDF into the terminal window to attach it.
3. Type this and press Enter:

   ```
   /lect Wireless Network
   ```

   ("Wireless Network" is the subject folder — use whatever your course is
   called. If the folder doesn't exist yet, it gets created.)
4. Wait. Claude reads the file, writes the notes, and saves them.

![Writing a note](docs/images/claude-code-lect.png)

Now open the app to read them:

```bash
npm run dev
```

Then visit **http://localhost:3000** in your browser. Sign in, and your
subject folders are in the sidebar. (If you installed the desktop app, just
open Notecom instead — no terminal needed.)

### Make a quiz from the same material

```
/quiz Wireless Network — what's the difference between TDMA and FDMA?
```

The quiz is saved next to your notes. Ask `/quiz` again in the same subject to
keep adding questions to it.

---

## Using the app day to day

- **Find something** — the search box at the top of the sidebar searches
  inside every note, not just the titles.
- **Star a note** — the ☆ on a row keeps it in Favourites at the top.
- **Generate without the terminal** — the upload button in the sidebar takes a
  file and runs the same note-writing, from inside the app.
- **Hide the sidebar** — the ☰ button in the top-left, at any window size.
- **Dark or light** — the sun/moon button in the sidebar header.

---

## Sharing with classmates

Every folder belongs to you and starts **private**. You decide who else sees
it, from the share button on a folder row.

- **Public** means *listed*: other signed-in people can find the folder by
  name and ask to join. It never means the notes are readable — only members
  read the files, always.
- **Joining is by approval.** Someone asks, you approve or reject in the
  folder's console. There is no automatic join.
- **Invite someone directly** — you can invite people who follow you. That is
  what stops strangers from spamming invitations.
- **Roles**: *viewer* reads, *editor* reads and writes, *owner* is you.
- **Tags** are a shortcut for groups: give a classmate a tag like `ISNE3RD`,
  and every folder you mark with that tag opens for them at once. Take the tag
  back and all of it closes again.

Your notes also sync to your account in the background, so the same vault
appears on every device you sign in to.

---

## Signing in

Notecom uses your email and a password, plus a code emailed to you:

1. Enter your email and password.
2. Check your inbox for an 8-digit code and type it in.

Both steps are required every time — knowing the password alone is not enough
to get in.

**Forgot your password?** Use "Forgot password?" on the sign-in page. You get
a link by email; open it *in the same browser you asked from*, and it takes
you straight to a page where you choose a new password.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `claude: command not found` | Close the terminal and open a new one, then try again |
| The app shows no notes | Make sure `/lect` wrote into *this* folder's `vault/`; the app only reads this one |
| Search finds nothing | Stop the app and run `npm run dev` again — it restarts the search service |
| The email code never arrives | Check spam. Codes expire after an hour; ask for a new one |
| A reset link says it was opened in a different browser | Request a new link and open it in the browser you asked from |
| Notes not appearing on another device | Sign in with the same account, and give the sync a minute |

---

## Updating

After pulling new changes:

```bash
npm run setup
npm run install:desktop   # only if you use the installed desktop app
```

---

## For developers

Notes are authored by **Claude Code** (`/lect`, `/quiz`) as HTML files in
`vault/`. The Next.js app imports them into Supabase and reads and writes
everything there directly — no local database, no sync worker, no sidecars, so
the desktop app, a dev server and a VPS all see the same rows at the same time.
The app never generates content and holds no API key. Search is Postgres
full-text over heading-sized chunks. Access control is entirely Row Level
Security — there is no service-role key anywhere in this app.

```bash
npm run dev             # http://localhost:3000
npm run dev:desktop     # native window (needs Rust)
npx tsc --noEmit        # type check
```

### Environment variables

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js | unset | **Required.** The Supabase project that stores everything — notes, folders, sharing, search |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Next.js | unset | **Required.** Publishable anon key for the same project; RLS is what protects the data |
| `VAULT_ROOT` | Next.js | `./vault` | Where Claude Code writes generated lessons; the app imports from it and never writes to it |
| `REPO_ROOT` | Next.js | `process.cwd()` | Checkout the packaged app runs the `claude` CLI from |
| `CLAUDE_BIN` | Next.js | `claude` | Override the Claude Code binary |
| `GENERATE_MODEL` | Next.js | `sonnet` | Model passed to `claude --model` for in-app generation |

### Generation is local, and it is everyone's

There is no read-only mode and no server-side generation. Every instance is fully
writable by whoever runs it, because generating a lesson spawns **that person's
own Claude Code CLI** on **their own Claude subscription** — the same
`/lect` or `/quiz` they could run in a terminal, at no charge beyond the
subscription they already pay for. The app orchestrates; it holds no API key and
never bills anyone.

That is also the limit. A subscription authenticates on the machine it belongs
to, so a hosted server cannot generate on a visitor's behalf: to generate, run
the app where your CLI is (the desktop app, or `npm run dev` on your own
machine). A deployment with no `claude` on PATH — a VPS — reads and edits shared
notes perfectly well; it just cannot generate, because the CLI it would need
isn't there. No flag says so; the missing dependency does.

Generation runs in the **background**: start it and keep reading. The sidebar
keeps a live row per run, the log is reachable from it, and the tree refreshes
itself when the file lands. Up to three runs at once.

### Deeper documentation

| Document | What's in it |
|---|---|
| [SPECIFICATION.md](SPECIFICATION.md) | the layer contract, end to end |
| [docs/architecture.md](docs/architecture.md) | data flow, and the rules that must not break |
| [docs/api-contract.md](docs/api-contract.md) | every endpoint |
| [docs/collaboration.md](docs/collaboration.md) | sharing model and RLS |
| [docs/ui-guidelines.md](docs/ui-guidelines.md) | design system and motion |
| [docs/desktop.md](docs/desktop.md) | the Tauri shell and packaging |
