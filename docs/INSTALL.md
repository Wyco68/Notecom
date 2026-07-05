# Installing Notes

Notes runs on **Windows, macOS, and Linux**. You do not need any developer
tools to install it — just download the file for your computer and open it.

## 1. Download

Go to the project's **Releases** page on GitHub and open the newest release.
Under **Assets**, download the file that matches your computer:

| Your computer | File to download |
|---|---|
| Windows | `Notes_..._x64-setup.exe` |
| macOS (Apple Silicon — M1/M2/M3) | `Notes_..._aarch64.dmg` |
| macOS (older Intel) | `Notes_..._x64.dmg` |
| Linux | `Notes_..._amd64.AppImage` (or the `.deb` on Debian/Ubuntu) |

Not sure which Mac you have? Click the Apple menu → **About This Mac**. If
it says "Apple M1/M2/M3", pick Apple Silicon; if it says "Intel", pick Intel.

## 2. Install

- **Windows:** double-click the `.exe` and click through. Windows may show a
  "Windows protected your PC" box (because the app isn't code-signed) — click
  **More info → Run anyway**.
- **macOS:** double-click the `.dmg`, drag **Notes** into Applications. The
  first time you open it, right-click the app → **Open** → **Open** (this is
  only needed once, because the app isn't notarized).
- **Linux:** make the `.AppImage` executable (right-click → Properties →
  Permissions → "allow executing"), then double-click it. Or install the
  `.deb` with your software centre.

Notes now lives in your Start Menu / Applications / app menu like any other
app. Opening it shows your notes — no terminal, no browser.

## 3. Where your notes are stored

Your notes live in a normal per-user folder, so they survive re-installs and
are easy to back up:

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\com.universitynotes.notes\vault` |
| macOS | `~/Library/Application Support/com.universitynotes.notes/vault` |
| Linux | `~/.local/share/com.universitynotes.notes/vault` |

## 4. Optional: turn on the AI features

The app **reads** your notes with zero setup. Two extra features need free
tools installed once:

### "Ask My Notes" chat + smart search
1. Install **[Ollama](https://ollama.com)** (one click, all three OSes).
2. Open a terminal once and run:
   ```
   ollama pull llama3.2
   ollama pull nomic-embed-text
   ```
That's it — chat and semantic search light up automatically. Everything runs
on your own machine; nothing is sent to the internet. Without Ollama, search
still works in plain keyword mode and the chat button explains what to
install.

### "Generate from file" (make new lessons/quizzes from a PDF)
This one drives **Claude Code** and currently needs the project's source
checkout to work (it uses the `/lect` and `/quiz` command files). It is aimed
at the project maintainer, not a download-only user. If the tool isn't set
up, the Generate window simply reports that `claude` wasn't found and nothing
breaks.

---

## For the maintainer: cutting a release

Installers are built automatically by GitHub Actions
([.github/workflows/release.yml](../.github/workflows/release.yml)) — you
never build all three OSes by hand.

1. Bump `version` in [desktop/tauri.conf.json](../desktop/tauri.conf.json)
   (and `package.json` to match).
2. Commit, then tag and push:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. Actions builds the Windows, macOS (Apple Silicon + Intel), and Linux
   installers on their own runners and uploads them to a **draft** GitHub
   Release named after the tag.
4. Open that release on GitHub, check the files, click **Publish**.

You can also trigger a build by hand from the **Actions** tab ("Run
workflow") without tagging.

Every normal push to `main` runs the lightweight
[ci.yml](../.github/workflows/ci.yml) check (type-check + compile both Go
services) so a broken build is caught before you ever cut a release.

### Building one installer locally (your own machine only)

```bash
npm run install:desktop
```

Builds just your current OS's installer into `installation/`. Use this for
quick local testing; use the tag-and-push flow above to produce installers
for all three OSes.

### Why there's no Docker image

Notes is a **desktop GUI app**, not a web server. Docker is built for
headless server workloads; running a native window inside a container needs
X11/VNC forwarding hacks that are more fragile and less friendly than a
normal installer — the opposite of "double-click to run for a non-technical
user". The native installers above are the clean way to ship this app, so
Docker is intentionally not part of the project.
