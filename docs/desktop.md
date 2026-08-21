# Desktop shell (`desktop/`)

Loaded by `/feat` only. The Tauri project that wraps the Next.js app into a
native window — see
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

`app/`, `components/` and `lib/` (the Next.js app) are unchanged and stay at the
repo root — see [architecture.md](architecture.md) for why nothing moved.

## Startup orchestration (`desktop/src/lib.rs`)

On launch: create a splash window (`assets/splash.html`) immediately, then
on a background thread:

1. Pick a free port for the Next server (bind `127.0.0.1:0`, read back the
   assigned port).
2. Start the Next server, given `VAULT_ROOT` so it can import Claude-authored
   lessons, and poll its port.
3. Emit `stage-update` events to the splash window (it listens via
   `window.__TAURI__.event.listen`, enabled by `app.withGlobalTauri`).
4. Create the main window pointed at `http://127.0.0.1:<port>/vault`, close
   the splash window.

One sidecar in the release build (`bundle.externalBin`): `node`, which runs the
Next standalone `server.js`. Startup used to be four processes — `vaultd`,
`indexd` and `stored` came first, because the app's data lived in a local SQLite
database that a background worker synced to Supabase. The app talks to Supabase
directly now, so there is nothing local left to start, and the splash screen has
one stage instead of four.

Credentials are the app's own: `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, baked into the build. The desktop shell holds
none of its own, and there is no service key anywhere — the signed-in user's JWT
plus RLS decides everything (see [collaboration.md](collaboration.md)).

The webview navigating to a `127.0.0.1` URL is not "opening localhost in a
browser" — it's the app's own native window loading the app's own local
server, the standard way Tauri/Electron ship a Next.js app that has live
API routes (no static export is possible with API routes in the mix).

The dev launch is OS-aware: `npm` is `npm.cmd` on Windows (needs `cmd /C`) but a
plain executable on macOS/Linux (invoked directly). That difference is isolated
to the `dev` module so `tauri dev` runs on all three platforms.

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
| Next | `npm run dev -- -p <port>` against the repo (`cmd /C npm` on Windows, `npm` directly elsewhere) | bundled Node sidecar running the standalone `server.js`, given `REPO_ROOT` so the in-app Generate button can run the claude CLI from the project dir |
| Vault location | repo's `vault/` (`CARGO_MANIFEST_DIR`'s parent) | a per-user app-data directory, resolved at runtime |

Dev mode stays checkout-centric — `tauri dev` always runs against the repo
it was launched from, and `/lect`/`/quiz` write straight to that repo's
`vault/`. Release builds (2026-08) no longer are: `CARGO_MANIFEST_DIR` is
baked in at *compile* time, so an installer built once and handed to someone
else would bake in the *building* machine's checkout path — useless the
moment it left that machine. A per-user OS data-dir vault was tried and
removed once already for splitting content across two locations with no
CI installer to justify it; now there is one, so the split earns its keep.

`release::project_root()` (`desktop/src/lib.rs`) resolves
`app.path().app_data_dir()/project` at launch instead, and
`release::sync_project_template()` copies `.claude/commands/{lect,quiz}.md`,
the docs they load, `CLAUDE.md`, `.mcp.json` and the validator scripts into
it from `bundle.resources` (`desktop/resources/claude-project/`, assembled by
`scripts/prepare-desktop-resources.mjs`) on every launch — an app update
always ships current commands. `vault/` lives inside that same project dir
but is never part of the bundled resource, so a user's actual notes are
never touched by the sync. `REPO_ROOT` and `VAULT_ROOT` both point inside
it, same as before.

Net effect: a release build no longer depends on the checkout that built
it, on any platform — a locally built install survives moving or deleting
the original clone, and a CI-built install works for whoever downloads it.
Distribution is still "get an installer and run it", not "clone the repo"
— see [GETTING_STARTED.md](GETTING_STARTED.md) for the case where someone
wants the dev workflow instead.

Sidecars are referenced by **basename only** (`sidecar("node")`, not
`sidecar("bin/node")`) — Tauri flattens `bundle.externalBin` entries to
sit directly next to the installed `.exe`, regardless of which
subdirectory they were built into.

## Build-time scripts (`scripts/`)

- **`ensure-desktop-sidecars.mjs`** (`build.beforeDevCommand`) — touches
  empty placeholder files at the sidecar paths and an empty
  `resources/frontend/` dir. Tauri's build script enforces that every
  `bundle.externalBin` entry and `bundle.resources` glob resolves to a real
  path *at compile time*, even for `tauri dev`, which never runs it (dev mode
  spawns `npm run dev` directly — see table above). This keeps `tauri dev` fast
  instead of paying for a full production build on every run.
- **`prepare-desktop-resources.mjs`** (`build.beforeBuildCommand`) — the
  real artifact build for `tauri build`:
  1. `next build` (standalone output), assemble `desktop/resources/frontend/`
     from `.next/standalone` + `.next/static` + `public/`.
  2. Copy the local Node executable to `desktop/bin/node-<target-triple>`
     (`.exe` on Windows) as the Node sidecar — `next build --output
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

Prerequisites (one-time, machine setup): Node 20+, Rust
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

Runs `prepare-desktop-resources.mjs` (`next build --output
standalone`, copies a Node sidecar) then `cargo tauri build`, then
`install-desktop.mjs` copies the finished installer into `installation/`
at the repo root and opens that folder. `bundle.targets: "all"` in
[tauri.conf.json](../desktop/tauri.conf.json) makes each OS emit its native
formats:

```
installation/Notecom_<version>_x64-setup.exe   Windows (NSIS)  -- run this
installation/Notecom_<version>_x64_en-US.msi    Windows (MSI)   -- or this
installation/Notecom_<version>_x64.dmg          macOS
installation/Notecom_<version>_amd64.AppImage    Linux (portable)
installation/Notecom_<version>_amd64.deb         Linux (Debian/Ubuntu)
```

`installation/` is emptied on each build so it only ever holds the latest
artifacts (it's gitignored — build output, not source). Running the
installer registers **Notecom** with the OS like any native app (Start Menu
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

## CI

**[.github/workflows/ci.yml](../.github/workflows/ci.yml)** — every push/PR
to `main` runs a fast check (`tsc --noEmit`), so a change that breaks the
build is caught early. It does not build installers; that's heavy and
belongs on a release, not every push.

**[.github/workflows/release.yml](../.github/workflows/release.yml)** — runs
on a `v*.*.*` tag push (or manually via `workflow_dispatch` against an
existing tag). Builds the installer on all three OSes (Windows NSIS+MSI,
macOS universal DMG, Linux AppImage+deb) and attaches them to a GitHub
Release named after the tag, with auto-generated release notes. Each tag is
its own release, so older versions stay downloadable — nothing is
overwritten by a newer tag. This only works because release builds resolve
their project dir at runtime now (see the table above); it would have shipped
broken installers under the old compile-time-baked path. A user who just
wants a local build without cutting a release still runs `npm run
install:desktop`, which is unaffected by any of this.

## Verifying a change here

`cargo check` and `cargo check --release` from `desktop/` only type-check
one `cfg` branch each (`dev` vs `release`) — `cargo check --release` is the
only way to catch mistakes in the release sidecar path before a full
`tauri build`. A real end-to-end check needs the actual CLI commands above,
since the sidecar/resource existence checks and capability permissions only
surface at that point, not at plain `cargo check`.
