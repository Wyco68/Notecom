// Run after /generate saves a lesson: make sure both servers are up
// (reusing whichever is already running, never starting a duplicate) and
// point the user's default browser at the app. No new server if one's
// already there — this only opens a window onto it.

import { spawn } from "child_process";
import net from "net";
import { ensureVaultd } from "./ensure-vaultd.mjs";

const PORT = process.env.PORT || 3000;
const APP_URL = `http://localhost:${PORT}/vault`;

// A plain TCP probe, not an HTTP request: Next dev can take many seconds to
// compile a page on first hit, which made an HTTP-based check time out and
// falsely report "down" — spawning a second `next dev` on the next port.
// Whether *something* is listening on the port is all we need to know.
function isPortOpen(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "localhost" });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitUntilPortOpen(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function ensureNextDev() {
  if (await isPortOpen(PORT)) {
    console.log(`Next.js already running at ${APP_URL}`);
    return;
  }

  console.log("starting npm run dev...");
  spawn("npm", ["run", "dev"], {
    shell: process.platform === "win32",
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  }).unref();

  if (!(await waitUntilPortOpen(PORT, 20000))) {
    throw new Error(`Next.js did not come up on port ${PORT} within 20s`);
  }
  console.log(`Next.js up at ${APP_URL}`);
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', url]]
      : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  // windowsHide keeps the `cmd /c start` helper window from flashing up.
  spawn(cmd[0], cmd[1], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
}

async function main() {
  await ensureVaultd();
  await ensureNextDev();
  openBrowser(APP_URL);
  console.log(`opened ${APP_URL}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
