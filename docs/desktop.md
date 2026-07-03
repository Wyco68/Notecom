# Desktop shell (`desktop/`)

Loaded by `/feat` only. The Tauri project that wraps the existing Next.js
app and Go helper into a native window — see
[architecture.md](architecture.md) for the rule that it holds no business
logic, only orchestration.

## Layout

```
desktop/
  Cargo.toml, build.rs        -- Rust crate
  tauri.conf.json             -- windows: [] (created programmatically, not declared)
  capabilities/default.json   -- event + sidecar-execute permissions
  assets/splash.html          -- the only "static frontendDist" Tauri needs
  src/lib.rs                  -- orchestrator (see below), src/main.rs entry point
  bin/                        -- sidecar binaries (gitignored, generated)
  resources/frontend/         -- Next standalone build output (gitignored, generated)
```

`app/`, `components/`, `lib/` (the Next.js app) and `tools/vaultd/` (the Go
helper) are unchanged and stay at the repo root — see
[architecture.md](architecture.md) for why nothing moved.

## Startup orchestration (`desktop/src/lib.rs`)

On launch: create a splash window (`assets/splash.html`) immediately, then
on a background thread:

1. Pick two free ports (bind `127.0.0.1:0`, read back the assigned port).
2. Start vaultd, poll its port until it accepts connections.
3. Start the Next server, poll its port the same way.
4. Emit `stage-update` events to the splash window at each step (it listens
   via `window.__TAURI__.event.listen`, enabled by `app.withGlobalTauri`).
5. Create the main window pointed at `http://127.0.0.1:<port>/vault`, close
   the splash window.

The webview navigating to a `127.0.0.1` URL is not "opening localhost in a
browser" — it's the app's own native window loading the app's own local
server, the standard way Tauri/Electron ship a Next.js app that has live
API routes (no static export is possible with API routes in the mix).

The dev sidecar launch is OS-aware: `npm` is `npm.cmd` on Windows (needs
`cmd /C`) but a plain executable on macOS/Linux (invoked directly), and the
locally built vaultd binary is `vaultd.exe` vs `vaultd`. Both differences are
isolated to the `dev` module so `tauri dev` runs on all three platforms.

On exit, every tracked PID is killed via `taskkill /T /F` (Windows), not
`Child::kill()` — on Windows `npm run dev` runs under `cmd /C`, which fans out
into npm → node → turbopack workers, and a plain kill only stops the immediate
`cmd.exe`, leaving that whole tree running. On macOS/Linux cleanup is a plain
`kill -9`, which fully reaps the release sidecars (single processes); a dev
`npm run dev` on those platforms can still leave a child `next dev` behind on
quit — a known dev-only limitation, harmless to the shipped release build.

### Dev vs release

Two separate code paths, picked by `cfg(debug_assertions)` (`dev` vs
`release` modules in `lib.rs`) — they differ enough (where the binaries
come from, where the vault lives) that sharing one parameterized function
would be more confusing than two complete ones:

| | Dev (`tauri dev`) | Release (`tauri build`) |
|---|---|---|
| vaultd | built from `tools/vaultd/` if missing, run directly | bundled sidecar, resolved via `app.shell().sidecar("vaultd")` |
| Next | `npm run dev -- -p <port>` against the repo (`cmd /C npm` on Windows, `npm` directly elsewhere) | bundled Node sidecar running the standalone `server.js` |
| Vault location | repo's `vault/` (gitignored, unchanged) | repo's `vault/` (same checkout, resolved from `CARGO_MANIFEST_DIR` baked in at compile time) — same vault `/lect` writes lessons into, single-machine personal tool |

Sidecars are referenced by **basename only** (`sidecar("vaultd")`, not
`sidecar("bin/vaultd")`) — Tauri flattens `bundle.externalBin` entries to
sit directly next to the installed `.exe`, regardless of which
subdirectory they were built into.

## Build-time scripts (`scripts/`)

- **`ensure-desktop-sidecars.mjs`** (`build.beforeDevCommand`) — touches
  empty placeholder files at the sidecar paths and an empty
  `resources/frontend/` dir. Tauri's build script enforces that every
  `bundle.externalBin` entry and `bundle.resources` glob resolves to a real
  path *at compile time*, even for `tauri dev`, which never runs them
  (dev mode talks to a plain local vaultd + `npm run dev` — see table
  above). This keeps `tauri dev` fast instead of paying for a full
  production build on every run.
- **`prepare-desktop-resources.mjs`** (`build.beforeBuildCommand`) — the
  real artifact build for `tauri build`:
  1. `go build` vaultd, copy to `desktop/bin/vaultd-<target-triple>.exe`.
  2. `next build` (standalone output), assemble `desktop/resources/frontend/`
     from `.next/standalone` + `.next/static` + `public/`.
  3. Copy the local Node executable to `desktop/bin/node-<target-triple>`
     (`.exe` on Windows) as the second sidecar — `next build --output
     standalone` still needs a Node runtime to execute `server.js`; there's
     no way to make Next itself a zero-runtime native binary.
- **`desktop-target-triple.mjs`** — the `<target-triple>` lookup shared by
  both scripts above (Tauri's sidecar naming convention). Covers Windows x64,
  macOS arm64/x64, and Linux x64/arm64.
- **`install-desktop.mjs`** (`postbuild:desktop`) — after `tauri build`,
  copies the platform's installer artifact(s) out of
  `desktop/target/release/bundle/**` into `installation/` at the repo root
  and opens that folder. Knows each OS's bundle subdir (`nsis`/`msi`, `dmg`,
  `appimage`/`deb`/`rpm`). It reveals the folder rather than auto-running the
  installer, so a `.dmg` mount or `.deb` permission prompt never fires
  unattended from a build.

`prepare-desktop-resources.mjs` and `ensure-desktop-sidecars.mjs` are already
OS-agnostic (they switch the `.exe` suffix off `process.platform` and shell
out to `go`/`npx`/`node` from `PATH`), so no per-OS branches live in them.

## Install & run

Prerequisites (one-time, machine setup): Node 20+, Go 1.21+, Rust
(`rustup`) + the platform's C/C++ build tools and webview:

| OS | Build tools | Webview |
|---|---|---|
| Windows | MSVC Build Tools | WebView2 (ships with Win11) |
| macOS | Xcode Command Line Tools (`xcode-select --install`) | WKWebView (built in) |
| Linux | `build-essential`, `libwebkit2gtk-4.1-dev`, `libssl-dev`, `libgtk-3-dev`, `librsvg2-dev` (Debian/Ubuntu names) | WebKitGTK |

Tauri builds are **not** cross-compiled — run the build on the OS you want
an installer for (a Mac produces the Mac installer, etc.).

**Build the installer:**

```bash
npm install
npm run build:desktop
```

Runs `prepare-desktop-resources.mjs` (Go build, `next build --output
standalone`, copies a Node sidecar) then `cargo tauri build`, then
`install-desktop.mjs` copies the finished installer into `installation/`
at the repo root and opens that folder. `bundle.targets: "all"` in
[tauri.conf.json](../desktop/tauri.conf.json) makes each OS emit its native
formats:

```
installation/Notes_<version>_x64-setup.exe   Windows (NSIS)  -- run this
installation/Notes_<version>_x64_en-US.msi    Windows (MSI)   -- or this
installation/Notes_<version>_x64.dmg          macOS
installation/Notes_<version>_amd64.AppImage    Linux (portable)
installation/Notes_<version>_amd64.deb         Linux (Debian/Ubuntu)
```

`installation/` is emptied on each build so it only ever holds the latest
artifacts (it's gitignored — build output, not source). Running the
installer registers **Notes** with the OS like any native app (Start Menu
on Windows, Applications on macOS, the app menu on Linux); after that it's
just launching the app, no terminal. Re-running `npm run build:desktop` +
the new installer after a source change replaces the install in place.

**Develop with hot reload** (skips the installer, runs straight from source):

```bash
npm run dev:desktop
```

Cold start (splash → loaded `/vault`) is dominated by the bundled Node
runtime booting the standalone server — roughly 8-10s in the packaged
build, faster in dev since `next dev` is already warm after the first run.

## Commands

```bash
npm run dev:desktop     # development: native window, hot reload
npm run build:desktop   # production: installer under desktop/target/release/bundle
```

## Verifying a change here

`cargo check` and `cargo check --release` from `desktop/` only type-check
one `cfg` branch each (`dev` vs `release`) — `cargo check --release` is the
only way to catch mistakes in the release sidecar path before a full
`tauri build`. A real end-to-end check needs the actual CLI commands above,
since the sidecar/resource existence checks and capability permissions only
surface at that point, not at plain `cargo check`.
