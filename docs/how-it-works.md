# How Notecom works

A plain-language walkthrough of what happens when you generate or read a
note. For the request-by-request technical version, see
[flow.md](../flow.md); for the layer contract, see
[SPECIFICATION.md](../SPECIFICATION.md).

---

## The one rule

Every copy of Notecom — hosted, desktop, your own `npm run dev` — reads the
same notes, straight from Supabase. Only one can **write** new ones:
generating a note runs your own Claude Code CLI, on your own subscription,
and only the machine that CLI is signed in on can do it.

```
                    DESKTOP APP                              HOSTED WEB APP
              ┌───────────────────────┐                 ┌───────────────────────┐
              │ Browser + Notecom app │                 │ Browser + Notecom app │
              │           +           │                 │                       │
              │   Claude Code CLI     │                 │    (no CLI here)      │
              │   signed in, ready    │                 │                       │
              └──────────┬────────────┘                 └──────────┬────────────┘
                          │  reads notes                            │  reads notes
                          │  writes new notes ──╮                   │
                          ▼                     │                   ▼
                    ┌─────────────────────────────────────────────────────┐
                    │                       Supabase                      │
                    │            (the one shared library everyone         │
                    │                    actually reads from)             │
                    └─────────────────────────────────────────────────────┘
```

Not a toggle, not a flag — a Claude subscription authenticates on the machine
it's signed in on, so a shared server can't generate on a visitor's behalf.
It reads and shares perfectly; it just has no CLI to write with.

---

## Writing a note

Nothing gets invented. Claude reads only the file you give it and writes
what's actually in there, in clearer words.

```
Generate → "Cybersecurity Fundamentals" + your lecture file
  → Claude (read-only) reads the file (PDF, slides, photo)
  → Claude writes a plain-language note, technical terms kept correct,
    grounded strictly in that file — nothing added from memory —
    and hands it back to the app
  → the app checks it against the note format (Claude fixes anything off)
  → the app numbers it (04-firewall-configuration) and saves it to Supabase
  → done
```

Claude never saves anything: it can only read. The app is the one that
saves, straight to Supabase, the one place every device reads from. Nothing
is kept on your machine.

```
Claude Code  ──HTML──►  Notecom (check, name)  ──saves──►  Supabase
```

---

## Reading a note

No sync step to wait for. Every device asks Supabase directly, on every
request — a note written on your laptop shows up on your phone the moment
you next open it there.

```
Browser
  │  opens a note
  ▼
Notecom app (Next.js)
  │  runs a permission-checked query — Row Level Security decides
  │  what comes back, not the app
  ▼
Supabase
  │  the note's html, or "not found" — which also quietly covers
  │  "exists, but you're not allowed to see it"
  ▼
Browser renders it on screen
```

Search works the same way: Supabase ranks the sections that match, and only
the ones you're allowed to read come back.

---

## Three things worth knowing

- **Folders, not files, are what's shared.** Sharing a folder shares every
  note and quiz inside it, at the role you gave the person — viewer or
  editor. See [collaboration.md](collaboration.md).
- **Deletes don't vanish.** Removing a note marks it deleted instead of
  dropping the row, so the app can always tell "gone" from "never existed" —
  it matters once a folder has more than one person.
- **No hidden cost.** Generating spends nothing beyond the Claude
  subscription you already pay for. Notecom holds no API key and never
  bills you.
