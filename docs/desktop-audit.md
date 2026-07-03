# Desktop Application — Deep Scan & Audit

Loaded by `/feat` only. A full read of the desktop shell (`desktop/`), its
build scripts (`scripts/*desktop*`, `scripts/ensure-vaultd.mjs`,
`scripts/open-app.mjs`), the Go helper (`tools/vaultd/`), and the Next.js
layers it wraps. Covers what the app does, how it is wired, the security and
resource findings, the macOS situation, and a prioritized backlog of future
improvements.

**This document is analysis only. Nothing here is implemented.**

Verified at audit time: `npx tsc --noEmit` clean, `go build ./...` +
`go vet ./...` clean in `tools/vaultd/`, `cargo check` and
`cargo check --release` clean in `desktop/`.

---

## 1. What the desktop app is

A [Tauri 2](https://tauri.app) native window that wraps the **existing**
Next.js reader app and the Go `vaultd` filesystem helper into one
double-clickable Windows program. The shell holds **no business logic** — it
only starts the two servers, shows a splash screen, opens the main window at
the local Next.js URL, and kills the child processes on exit
(see [architecture.md](architecture.md), [desktop.md](desktop.md)).

### Process model at runtime

```
Notes.exe (Tauri / WebView2)
├── splash window          assets/splash.html  (native, decoration-less)
├── main window            WebView2 → http://127.0.0.1:<nextPort>/vault
├── child: vaultd          127.0.0.1:<vaultdPort>   filesystem I/O only
└── child: node server.js  127.0.0.1:<nextPort>     Next.js standalone
        └── talks to vaultd via VAULTD_URL
```

Two ephemeral ports are chosen at launch (`free_port()` binds `127.0.0.1:0`,
reads the assigned port back). Everything is loopback-only; nothing listens on
an external interface.

### Startup sequence (`desktop/src/lib.rs`)

1. `setup()` creates the splash window immediately, then spawns a background
   thread running `orchestrate()`.
2. `orchestrate()` (dev or release variant, chosen by `cfg(debug_assertions)`):
   pick two free ports → start vaultd → `wait_for_port` → start Next →
   `wait_for_port` → `track_pids` → `finish_launch`.
3. `finish_launch()` emits a final stage event, then on the main thread builds
   the `main` window pointed at `/vault` and closes the splash.
4. On `RunEvent::Exit`, every tracked PID is killed with `taskkill /T /F`
   (Windows) or `kill -9` (other).

### Dev vs release (two separate code paths)

| | Dev (`tauri dev`) | Release (`tauri build`) |
|---|---|---|
| vaultd | `go build` if `vaultd.exe` missing, then run it directly | bundled sidecar via `app.shell().sidecar("vaultd")` |
| Next | `cmd /C npm run dev -- -p <port>` against the repo | bundled Node sidecar running standalone `server.js` |
| Vault dir | repo `vault/` | repo `vault/` (resolved from `CARGO_MANIFEST_DIR`, baked in at compile time) |

### Build pipeline (`scripts/`)

- `ensure-desktop-sidecars.mjs` (`beforeDevCommand`) — writes empty placeholder
  sidecar/resource files so `tauri-build`'s compile-time existence check passes
  without a full production build on every `tauri dev`.
- `prepare-desktop-resources.mjs` (`beforeBuildCommand`) — `go build` vaultd →
  `next build` standalone → assemble `resources/frontend/` → copy the running
  Node executable as the second sidecar.
- `desktop-target-triple.mjs` — shared `<name>-<target-triple>` suffix lookup.
- `install-desktop.mjs` (`postbuild:desktop`) — finds the freshly built NSIS
  `*-setup.exe` and launches it.

---

## 2. Security findings

Threat model note: this is a **single-user, single-machine** tool. Everything
binds loopback, there is no network exposure, no multi-tenant data, and the
lesson HTML is authored by a trusted local author (Claude Code via `/lect`),
not by untrusted uploads. That context lowers the severity of most items — but
several are still worth fixing because they widen the blast radius of a bug or
a hostile local web page.

### S1 — `safeName` accepts `.`, enabling a whole-vault delete (Medium) — FIXED

> **Fixed (polish pass):** `safeName` now also rejects any name with a leading
> `.` (covering `.`, `..`, and hidden dotfiles). Verified by a Go unit test
> asserting `.`/`..`/`...`/`.hidden`/slash/`..`-embedded are rejected while real
> slugs (`keepme`, `01-intro`, `quiz-01`, …) are accepted.


`tools/vaultd/main.go` → `safeName()`:

```go
func safeName(name string) (string, bool) {
	if name == "" || strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		return "", false
	}
	return name, true
}
```

The guard rejects `..`, `/`, `\`, and empty — but **not** a single `.`. A bare
`.` passes validation, and:

```
DELETE /folder/.   →   os.RemoveAll(filepath.Join(vaultRoot(), "."))
                   →   os.RemoveAll(vaultRoot())      // deletes the ENTIRE vault
```

Same class of problem for any name that is only dots (`.`), and for names with
trailing dots/spaces on Windows (`con `, `foo.`) which the filesystem
normalizes. The app UI is unlikely to send `.`, but vaultd is a raw HTTP
service on a known loopback port — any local process (or a browser page that
can reach the port, see S2) can call it directly. This is the single most
important finding: a one-request accidental or hostile wipe of all notes.

Fix direction (future work): reject `name == "."`, names consisting only of
dots, and trailing dot/space; prefer an allowlist (`^[a-z0-9][a-z0-9-]*$`)
since every name reaching vaultd is already a slug produced by
`lib/vault/slug.ts`.

### S2 — vaultd has no `Host`/origin check; DNS-rebinding surface (Low)

vaultd validates path names but never checks the `Host` header or request
origin, and sends no CORS headers. In desktop mode the port is ephemeral and
practically unguessable, which mitigates this. In **web mode** the port is a
fixed, well-known `127.0.0.1:4321`. A malicious web page the user visits cannot
do a JSON `POST` cross-origin without a CORS preflight (which vaultd doesn't
answer, so the browser blocks it) — but a DNS-rebinding attack that makes the
attacker origin resolve to `127.0.0.1` sidesteps the same-origin check
entirely, and vaultd would happily serve `/tree`, delete folders, etc. Low
likelihood, high-ish impact given S1.

Fix direction: reject requests whose `Host` is not `127.0.0.1:<port>` /
`localhost:<port>`; only vaultd's own trusted caller (`lib/vault/helper.ts`)
needs to reach it.

### S3 — Mermaid runs with `securityLevel: "loose"` (Low)

`components/viewer/Mermaid.tsx` initializes Mermaid with
`securityLevel: "loose"` and injects the rendered SVG with
`dangerouslySetInnerHTML`. `loose` disables Mermaid's sanitization and allows
raw HTML in node labels and `click`/`callback` directives — i.e. script
execution paths inside a diagram. `HtmlRenderer` deliberately avoids
`dangerouslySetInnerHTML` for lesson HTML precisely to prevent this, so Mermaid
is the one XSS surface that bypasses that policy. Content is self-authored so
the practical risk is low today, but `strict` (or `antiscript`) closes the hole
with no downside unless click-interactive diagrams are ever needed.

### S4 — No Content-Security-Policy on the webview (Low, hardening)

`desktop/tauri.conf.json` sets `"security": { "csp": null }`. The main window
loads remote-style content over `http://127.0.0.1`, so a strict CSP is fiddly,
but `null` means no restriction at all. A CSP that allows only
`self` / `127.0.0.1` for scripts, styles, and connections would contain the
damage if S3 (or any injected script) ever fired.

### S5 — Next API routes and vaultd have no authentication (Accepted)

Neither layer authenticates. Correct for a personal loopback tool; called out
so it's a conscious decision, not an oversight. Do **not** add auth without a
real multi-user requirement — it would violate the "small and dumb" contract.

---

## 3. Memory-leak & resource findings

No leaks that grow unbounded over a session were found. The items below are
races, ignored error signals, and minor re-render churn.

### M1 — `LessonViewer` fetch has no cancellation → stale-response race (Medium) — FIXED

> **Fixed (polish pass):** the effect now sets a `cancelled` flag in its cleanup
> (matching `Mermaid`) and guards `setHtml`, plus a `.catch` so a failed load
> shows an error instead of hanging on the skeleton. Verified in-browser with a
> rapid quiz→lesson→quiz switch — the last selection wins, no stale content.


`components/viewer/LessonViewer.tsx`:

```tsx
useEffect(() => {
  if (!lesson) { setHtml(null); return; }
  setHtml(null);
  fetch(`/api/lesson/${...}`)
    .then((r) => r.json())
    .then((data) => setHtml(data.html ?? `<p>Error: ...</p>`));
}, [lesson]);
```

Unlike `Mermaid` (which uses a `cancelled` flag), this effect never cancels the
in-flight request. Switching lessons quickly can let an **earlier** fetch
resolve **after** a later one, leaving the wrong lesson's HTML on screen; it can
also call `setHtml` after the component has moved on. Not a leak, but a
correctness bug under fast navigation.

Fix direction: `AbortController` in the effect, or a `cancelled` guard like
`Mermaid` already uses.

### M2 — `wait_for_port` return value is discarded (Medium, robustness)

`orchestrate()` (both dev and release) calls `wait_for_port(...)` but ignores
the `bool`. If vaultd or Next never come up within the timeout, the code still
proceeds to `finish_launch`, opening the main window at a server that isn't
listening → a blank/error webview with no message on the splash. The splash's
`stage-update` channel is the natural place to report the failure.

Fix direction: on `false`, emit an error stage and keep the splash open (or
show a retry) instead of opening a dead main window.

### M3 — Free-port TOCTOU window (Low)

`free_port()` binds `127.0.0.1:0`, reads the port, then drops the listener; the
child binds the same port milliseconds later. Between the two, another process
could claim the port, and the child would fail to bind. Standard for this
pattern and rare on a personal machine, but it is a real gap (and `vaultd`'s own
bind failure is only surfaced by `ensure-vaultd.mjs` in web mode, not by the
desktop orchestrator).

### M4 — Orphan child processes if the app is hard-killed (Low, known trade-off)

Cleanup runs only on `RunEvent::Exit`. If `Notes.exe` is force-killed or
crashes, the tracked PIDs are never reaped. On Windows the dev tree (`cmd` →
`npm` → `node` → turbopack workers) is the worst case; release is just two
processes. `taskkill /T` handles the tree on a clean exit. A watchdog or
job-object association would guarantee reaping.

### M5 — `ToastProvider` rebuilds its context value every render (Low, perf) — FIXED

> **Fixed (polish pass):** `api` is now wrapped in `useMemo([push])`; `push` is
> already a stable `useCallback`, so consumers no longer re-render on every
> toast add/remove.


`components/toast/ToastProvider.tsx` creates a fresh `api` object on every
render, so every `useToast()` consumer re-renders whenever a toast is
added/removed. Harmless at this scale; `useMemo` on `api` would remove the
churn.

### M6 — `MutationObserver` and Mermaid effects are correctly cleaned up (Good)

`Mermaid.tsx` disconnects its `MutationObserver` and guards its async render
with a `cancelled` flag; `ManagedChildren` is a bounded `Vec` (two PIDs per
launch, launched once). No action needed — recorded so a future reviewer
doesn't re-flag them.

---

## 4. Functional correctness — smaller notes

- **`safeName` blocks legitimate `..` substrings** (e.g. a folder literally
  named `a..b`). Acceptable given slugs never contain dots, but an allowlist
  would be both safer (S1) and less surprising.
- **`deleteLesson` compaction** (`kept := entries[:0]`) reuses the backing
  array in place — correct and idiomatic; no aliasing bug because the result is
  immediately re-serialized.
- **`allowedDevOrigins: ["127.0.0.1"]`** in `next.config.mjs` is required
  because the webview navigates to `127.0.0.1`, which Next's dev-origin check
  treats as cross-origin vs `localhost`. Correct and load-bearing — don't
  remove.
- **Splash trusts `window.__TAURI__`** with no guard; fine because
  `app.withGlobalTauri` guarantees it, and the splash only ever loads the
  bundled `assets/splash.html`.

---

## 5. macOS / Linux

> **Update (cross-platform branch):** native macOS and Linux desktop builds
> are now implemented. `install-desktop.mjs` collects the platform's installer
> (`.dmg`, `.AppImage`/`.deb`/`.rpm`) into `installation/`, the dev shell spawns
> `npm`/`vaultd` portably, and `desktop-target-triple.mjs` covers Darwin +
> Linux. The remaining gap is **code signing / notarization** (F5 below) — an
> unsigned `.app` is still Gatekeeper-blocked by default, and Linux packages are
> unsigned. The original Windows-only analysis is kept below for history.

### Why the desktop build did not originally run on macOS

The **release runtime** is mostly portable (sidecars, and `kill_tree` has a
`kill -9` branch for non-Windows), but the surrounding pieces are hard-wired to
Windows:

1. **Dev mode is Windows-only.** `desktop/src/lib.rs` dev `spawn_next` runs
   `Command::new("cmd").args(["/C", "npm", ...])` — `cmd.exe` does not exist on
   macOS — and dev `spawn_vaultd` hard-codes the `vaultd.exe` filename. So
   `npm run dev:desktop` cannot work on a Mac without code changes.
2. **The install flow is NSIS-only.** `scripts/install-desktop.mjs`
   (`postbuild:desktop`) looks **only** in
   `desktop/target/release/bundle/nsis/` for a `*-setup.exe`. On macOS
   `tauri build` emits `.app`/`.dmg` under `bundle/macos` + `bundle/dmg`, so
   `npm run install:desktop` would fail at the postbuild step with
   "No installer found."
3. **No macOS packaging is wired.** No code signing, no notarization, no
   entitlements — an unsigned `.app` is blocked by Gatekeeper by default.
4. **Docs and setup assume Windows** — the README's "Start Menu" flow and the
   WebView2 note in [desktop.md](desktop.md) are Windows-specific (macOS uses
   the OS WKWebView, which is fine, but nothing documents the Mac path).

`desktop-target-triple.mjs` *does* enumerate the two Darwin triples and
`prepare-desktop-resources.mjs` *does* handle the no-`.exe` suffix, so a Mac
build is reachable with modest work (see F5) — but it is **not** wired today.

### Recommended path for Mac users today: run the web app

The Next.js reader is fully cross-platform and is the supported way to read and
manage notes on macOS. `scripts/open-app.mjs` already has a `darwin` branch
(`open <url>`), so the "write a lesson, open the reader" flow works unchanged.

**One-time setup (macOS):**

```bash
# Prerequisites: Node 20+, Go 1.21+
npm install
```

**Run it (development server — simplest):**

```bash
npm run dev
# predev → scripts/ensure-vaultd.mjs builds+starts vaultd on 127.0.0.1:4321,
# then Next dev starts on http://localhost:3000
```

Open **http://localhost:3000/vault** in any browser. Leave the terminal
running — closing it stops the server (there is no tray/splash like the desktop
app; it's just a browser tab).

**Or run the production web server** (faster page loads, still local):

```bash
npm run build
npm run start          # prestart → ensure-vaultd.mjs; serves on :3000
```

**Writing lessons on Mac** is identical to Windows: in Claude Desktop or the
Claude VS Code extension, `/lect <folder>` writes into `vault/` through vaultd,
and the open-app step opens your default browser via the `darwin` branch.

**Caveats on Mac web mode:**

- vaultd is fixed at `127.0.0.1:4321` in web mode (not ephemeral like the
  desktop app). If that port is busy, `ensure-vaultd.mjs` prints a
  `lsof`-equivalent hint — free the port and retry.
- The vault lives in the repo's `vault/` directory (gitignored), same as
  Windows — notes are local to the checkout.

---

## 6. Future implementation backlog (NOT implemented — proposals only)

Ordered by value. Each is a proposal with rationale; none are built.

### Correctness & safety (do these first)

- **F1 — Harden `safeName` (fixes S1).** *Done (polish pass):* leading-dot
  rejection added, covered by a Go unit test. A full allowlist regex remains a
  possible future tightening but the footgun is closed.
- **F2 — Cancel the `LessonViewer` fetch (fixes M1).** *Done (polish pass):*
  `cancelled` flag + `.catch` added; verified in-browser.
- **F3 — Surface startup failures on the splash (fixes M2).** Check
  `wait_for_port`'s return; on timeout, emit an error stage and keep the splash
  up with a retry/quit affordance instead of opening a dead window.
- **F4 — `Host`-header guard on vaultd (fixes S2).** Reject non-loopback
  `Host` values; closes the DNS-rebinding surface, especially for the
  fixed-port web mode.

### macOS & cross-platform

- **F5 — macOS/Linux desktop build.** *Partially done (cross-platform branch):*
  portable dev spawn, `install-desktop.mjs` collects the platform artifact into
  `installation/`, and the triple lookup covers Darwin + Linux. **Remaining:**
  macOS code signing + notarization and Linux package signing so the installers
  aren't OS-blocked as untrusted.
- **F6 — Cross-platform install docs.** *Done:* README and
  [desktop.md](desktop.md) now cover per-OS prerequisites, bundle outputs, and
  the `installation/` folder.

### Robustness & lifecycle

- **F7 — Reap orphans on hard-kill (addresses M4).** Associate children with a
  Windows Job Object (and a process-group / `prctl(PR_SET_PDEATHSIG)` on
  Unix) so the OS tears them down even if `Notes.exe` crashes.
- **F8 — Health-gate the main window.** After `wait_for_port`, do one HTTP
  probe of `/vault` (Next) and `/tree` (vaultd) before opening the main window,
  so a booted-but-not-ready server doesn't flash an error page.
- **F9 — Retry/backoff on port binding (addresses M3).** If a child fails to
  bind its chosen port, pick another and retry rather than launching into a
  half-dead state.

### Security hardening

- **F10 — Set a Content-Security-Policy (addresses S4).** Lock scripts/styles/
  connections to `self` + the local origin in `tauri.conf.json`.
- **F11 — Mermaid `securityLevel: "strict"` (fixes S3).** Unless click-
  interactive diagrams become a requirement, switch off `loose` to eliminate
  the one script-execution surface that bypasses `HtmlRenderer`'s no-`innerHTML`
  policy.

### UX & performance

- **F12 — Cut cold-start time.** Docs note ~8–10s cold start dominated by the
  bundled Node runtime booting `server.js`. Options: keep a warm server between
  launches, precompile/route-cache, or explore a lighter runtime. Biggest
  perceived-quality win.
- **F13 — Auto-updater.** Wire `tauri-plugin-updater` so "re-run the installer
  after pulling" (current README flow) becomes an in-app update.
- **F14 — In-app lesson search.** A client-side index over `index.json` titles
  (and optionally body text) — the vault grows monotonically and there is no
  way to find a lesson except scanning the tree.
- **F15 — Memoize `ToastProvider`'s context value (addresses M5).** *Done
  (polish pass):* wrapped in `useMemo`.
- **F16 — System tray + single-instance focus.** `tauri-plugin-single-instance`
  is already wired to focus the main window; a tray icon (minimize-to-tray,
  quick "New note" / "Open vault") would round out the native feel.

---

## 7. One-line summary

Architecture is clean and the layering rule (Next manages / vaultd is dumb I/O
/ shell only orchestrates) is respected throughout. The **one bug to fix now**
is `safeName` accepting `.` (whole-vault delete, S1/F1); the **one race** is the
uncancelled `LessonViewer` fetch (M1/F2); and the app is **Windows-only today**,
so Mac users should run the web app (§5) until a native Mac build is wired
(F5).
