// Runs after `npm run build:desktop` (postbuild:desktop). Collects the current
// platform's installer artifact(s) out of Tauri's `desktop/target/release/bundle`
// tree and copies them into a single predictable `installation/` folder at the
// repo root — so "build the app" ends with the file-to-run sitting in one
// obvious place instead of buried under a platform-specific bundle subdir.
//
// Cross-platform: NSIS/MSI on Windows, DMG on macOS, AppImage/deb/rpm on Linux.

import { existsSync, readdirSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = path.join(ROOT, "desktop", "target", "release", "bundle");
const OUT_DIR = path.join(ROOT, "installation");

// Per-platform: which bundle subdirs hold the end-user installer, and which
// file extensions count as "the thing you run to install". Ordered by
// preference — the first match is what the user is pointed at first.
const PLATFORM_ARTIFACTS = {
  win32: [
    { dir: "nsis", exts: [".exe"] },
    { dir: "msi", exts: [".msi"] },
  ],
  darwin: [{ dir: "dmg", exts: [".dmg"] }],
  linux: [
    { dir: "appimage", exts: [".appimage"] },
    { dir: "deb", exts: [".deb"] },
    { dir: "rpm", exts: [".rpm"] },
  ],
};

function collectArtifacts() {
  const specs = PLATFORM_ARTIFACTS[process.platform];
  if (!specs) throw new Error(`unsupported platform: ${process.platform}`);
  const found = [];
  for (const { dir, exts } of specs) {
    const abs = path.join(BUNDLE_DIR, dir);
    if (!existsSync(abs)) continue;
    for (const file of readdirSync(abs)) {
      if (exts.some((e) => file.toLowerCase().endsWith(e))) {
        found.push(path.join(abs, file));
      }
    }
  }
  return found;
}

// Open the installation folder in the OS file manager so the installer is one
// click away. Deliberately NOT auto-running it — a .dmg mount or a .deb/.rpm
// permission prompt shouldn't fire unattended from a build script.
function openFolder(dir) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer", [dir]]
      : process.platform === "darwin"
      ? ["open", [dir]]
      : ["xdg-open", [dir]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // The reveal is a nicety; never fail the build over it.
  }
}

const artifacts = collectArtifacts();
if (artifacts.length === 0) {
  console.error(
    `No installer found under ${BUNDLE_DIR}. Did \`npm run build:desktop\` finish successfully?`
  );
  process.exit(1);
}

// Start from a clean folder so it only ever holds the latest build's output —
// no stale installers from an older version to confuse which one to run.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const copied = [];
for (const src of artifacts) {
  const dest = path.join(OUT_DIR, path.basename(src));
  copyFileSync(src, dest);
  copied.push(dest);
}

console.log(`\nInstaller ready in installation/ :`);
for (const file of copied) console.log(`  ${path.relative(ROOT, file)}`);
console.log(`\nOpen that file to install Notes.\n`);

openFolder(OUT_DIR);
