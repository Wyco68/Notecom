// Prints a laid-out cheatsheet to a PDF in the reader's Downloads folder.
//
// The one place the app writes a file outside a run's temp dir, and narrowly:
// a user-asked export, of a sheet only its owner can print, under a name the
// server picks, into the Downloads folder of the machine running the server.
// Cheatsheets only exist where the Claude Code CLI does — the reader's own
// machine — so that folder is theirs.
//
// The renderer is a Chromium-family browser already on the machine (Chrome,
// Chromium, Edge, Brave), run headless. Its pages are the same fixed-size
// boxes the preview shows, so the PDF matches the preview page for page; the
// app ships no browser of its own.

import { spawn, type ChildProcess } from "child_process";
// globSync is Node 22+; on an older runtime the cache lookup just finds nothing.
import { existsSync, globSync, readFileSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { homedir, tmpdir } from "os";
import path from "path";

const RENDER_TIMEOUT_MS = 60_000;

/** A headless-capable browser on this machine, or null. */
export function findBrowser(): string | null {
  const env = process.env.SHEET_PDF_BROWSER;
  if (env && existsSync(env)) return env;

  const candidates: string[] = [];
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(
      Boolean
    ) as string[];
    for (const r of roots) {
      candidates.push(
        path.join(r, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(r, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(r, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(r, "Chromium", "Application", "chrome.exe")
      );
    }
  } else if (process.platform === "darwin") {
    for (const app of ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser"]) {
      candidates.push(`/Applications/${app}.app/Contents/MacOS/${app}`);
      candidates.push(path.join(homedir(), `Applications/${app}.app/Contents/MacOS/${app}`));
    }
  } else {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      for (const name of [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "microsoft-edge-stable",
        "brave-browser",
        "chrome-headless-shell",
      ]) {
        candidates.push(path.join(dir, name));
      }
    }
    candidates.push("/snap/bin/chromium");
  }
  // Playwright's browser cache, on any platform: often present on a dev machine.
  for (const pattern of [
    "ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell*",
    "ms-playwright/chromium-*/chrome-*/chrome",
  ]) {
    const base = process.platform === "darwin" ? path.join(homedir(), "Library", "Caches") : path.join(homedir(), ".cache");
    try {
      candidates.push(...globSync(path.join(base, pattern)).sort().reverse());
    } catch {
      // No glob support or no cache: nothing to add.
    }
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** The reader's Downloads folder (XDG-aware on Linux), falling back to home. */
export function downloadsDir(): string {
  const home = homedir();
  if (process.platform === "linux") {
    const conf = path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "user-dirs.dirs");
    try {
      const m = /^XDG_DOWNLOAD_DIR="?([^"\n]+)"?/m.exec(readFileSync(conf, "utf8"));
      if (m) {
        const dir = m[1].replace(/^\$HOME/, home);
        if (existsSync(dir)) return dir;
      }
    } catch {
      // No user-dirs config: the default below.
    }
  }
  const dir = path.join(home, "Downloads");
  return existsSync(dir) ? dir : home;
}

/** A name in `dir` that doesn't overwrite anything: "x.pdf", "x (2).pdf", ... */
function freeName(dir: string, base: string): string {
  for (let n = 1; ; n++) {
    const file = path.join(dir, n === 1 ? `${base}.pdf` : `${base} (${n}).pdf`);
    if (!existsSync(file)) return file;
  }
}

/**
 * Renders `html` (a whole document) to PDF and saves it as `<base>.pdf` in the
 * Downloads folder. Returns the saved path.
 *
 * Printed through the DevTools protocol (Page.printToPDF), not the
 * `--print-to-pdf` switch: the switch hangs on some Chromium builds (Brave
 * never exits and writes nothing), while the protocol is the same in all of
 * them. Needs Node's global WebSocket (22+, which the desktop bundle ships).
 */
/**
 * `html` is tried first; when it overflows a page in this browser and a
 * `fallback` is given, the fallback is printed instead (see printPage).
 */
export async function savePdf(browser: string, html: string, base: string, fallback?: string): Promise<string> {
  const work = await mkdtemp(path.join(tmpdir(), "notes-sheet-pdf-"));
  // Its own process group, so the whole browser goes at the end — launchers
  // like /usr/bin/brave-browser are shell scripts, and killing only the
  // script would leave the browser running.
  const child = spawn(
    browser,
    [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // Its own profile: a browser the reader already has open would
      // otherwise take the command over.
      `--user-data-dir=${path.join(work, "profile")}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, detached: process.platform !== "win32" }
  );
  const timer = setTimeout(() => killTree(child.pid), RENDER_TIMEOUT_MS);
  try {
    const page = path.join(work, "sheet.html");
    await writeFile(page, html);
    let alt: string | undefined;
    if (fallback) {
      alt = path.join(work, "sheet-exact.html");
      await writeFile(alt, fallback);
    }
    const endpoint = await devtoolsEndpoint(child);
    const pdf = await printPage(endpoint, pathToFileUrl(page), alt && pathToFileUrl(alt));
    const target = freeName(downloadsDir(), base.replace(/[^\w.-]+/g, "-"));
    // wx: never overwrite, even if a same-named file appeared since freeName looked.
    await writeFile(target, pdf, { flag: "wx" });
    return target;
  } finally {
    clearTimeout(timer);
    killTree(child.pid);
    rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function devtoolsEndpoint(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let err = "";
    child.stderr?.on("data", (d: Buffer) => {
      err += d.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
      if (m) resolve(m[1]);
    });
    child.on("error", reject);
    child.on("close", () => reject(new Error("the browser exited before it was ready")));
  });
}

// True when some page's columns overflow, i.e. content would be cut off: a
// page box has a fixed height, so too much text only grows sideways.
const OVERFLOWS = `[...document.querySelectorAll(".cols")].some((c) => c.scrollWidth > c.clientWidth + 1)`;

async function printPage(endpoint: string, url: string, fallbackUrl?: string): Promise<Buffer> {
  const ws = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("could not connect to the browser"));
  });
  let next = 0;
  const pending = new Map<number, (m: any) => void>();
  const listeners: Array<(m: any) => void> = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)!(m);
      pending.delete(m.id);
    } else {
      listeners.forEach((l) => l(m));
    }
  };
  const send = (method: string, params: object = {}, sessionId?: string) =>
    new Promise<any>((resolve, reject) => {
      const id = ++next;
      pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  try {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    const loaded = new Promise<void>((resolve) =>
      listeners.push((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId && resolve())
    );
    await send("Page.navigate", { url }, sessionId);
    await loaded;
    if (fallbackUrl) {
      // Evaluated by the protocol, not the page: the page's own policy still
      // forbids every script.
      const { result } = await send("Runtime.evaluate", { expression: OVERFLOWS, returnByValue: true }, sessionId);
      if (result?.value !== false) {
        const again = new Promise<void>((resolve) =>
          listeners.push((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId && resolve())
        );
        await send("Page.navigate", { url: fallbackUrl }, sessionId);
        await again;
      }
    }
    const { data } = await send(
      "Page.printToPDF",
      {
        // The sheet's own @page decides the paper; the pages carry their margins.
        preferCSSPageSize: true,
        printBackground: true,
        displayHeaderFooter: false,
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 0,
        marginRight: 0,
      },
      sessionId
    );
    await send("Browser.close").catch(() => {});
    return Buffer.from(data, "base64");
  } finally {
    ws.close();
  }
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Already gone.
  }
}

function pathToFileUrl(p: string): string {
  const abs = path.resolve(p).replace(/\\/g, "/");
  return `file://${abs.startsWith("/") ? "" : "/"}${encodeURI(abs)}`;
}
