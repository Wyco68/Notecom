# Notes

Turns slides/PDFs into plain-language study notes, readable in a clean
desktop app. Works for any subject.

## Install (no build tools)

Download the installer for your OS from the **Releases** page and open it —
Windows, macOS, and Linux are all published there. Full step-by-step,
including the optional AI setup, is in **[docs/INSTALL.md](docs/INSTALL.md)**.

Your notes are stored in a normal per-user folder (survives re-installs), so
the same installer works on any machine.

### Build it yourself instead (one time)

If you'd rather build from source on your own machine:

```bash
npm run install:desktop
```

When it finishes, the `installation/` folder opens with the installer for
your OS inside — open that file and click through it. **Notes** then lives
in your Start Menu (Windows), Applications (macOS), or app menu (Linux).

Maintainers: pushing a `v*` git tag builds all three OSes' installers in CI
and attaches them to a GitHub Release — see [docs/INSTALL.md](docs/INSTALL.md).

## Write a note

1. Open this repo in Claude Desktop or the Claude VS Code extension.
2. Attach your slide/PDF.
3. Type:
   ```
   /lect Wireless Network
   ```
   (folder name only, or `folder/filename` to set the title yourself)
4. Claude writes the note, saves it, opens the reader.

## Read your notes

Open **Notes** from your Start Menu / Applications / app menu. No terminal,
no browser.

## Make a quiz

1. Paste a Markdown file of questions, or just paste one question, e.g.:
   ```
   /quiz Wireless Network — what's the difference between TDMA and FDMA?
   ```
2. Claude reasons through it, writes the answer, saves it next to your
   notes. Say `/quiz` again with no folder/title to keep adding questions
   to the same quiz.

## Change the app itself

Type a request starting with `/feat`, e.g.:
```
/feat add a delete button next to each lesson
```

**Rule:** lesson content → `/lect`. Quiz content → `/quiz`. App/code →
`/feat`. Never mix two of these in one request.

## Updating after pulling changes

```bash
npm run install:desktop
```

Re-installs in place.

---

Details: [SPECIFICATION.md](SPECIFICATION.md) (architecture),
[docs/desktop.md](docs/desktop.md) (desktop app internals).
