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

// True when some page's columns overflow, i.e. content would be cut off: a
// page box has a fixed height, so too much text only grows sideways.
const OVERFLOWS = `[...document.querySelectorAll(".cols")].some((c) => c.scrollWidth > c.clientWidth + 1)`;

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

interface Tab {
  send: (method: string, params?: object) => Promise<any>;
  /** navigates and waits for the load event */
  open: (url: string) => Promise<void>;
}

/**
 * Runs `fn` against one tab of a headless browser started for it, and takes
 * the whole browser down afterwards. Driven through the DevTools protocol, not
 * command-line switches: `--print-to-pdf` hangs on some Chromium builds (Brave
 * never exits and writes nothing), while the protocol is the same in all of
 * them. Needs Node's global WebSocket (22+, which the desktop bundle ships).
 */
async function withTab<T>(browser: string, timeoutMs: number, fn: (tab: Tab, work: string) => Promise<T>): Promise<T> {
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
  const timer = setTimeout(() => killTree(child.pid), timeoutMs);
  let ws: WebSocket | undefined;
  try {
    const endpoint = await devtoolsEndpoint(child);
    ws = new WebSocket(endpoint);
    const socket = ws;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("could not connect to the browser"));
    });
    let next = 0;
    const pending = new Map<number, (m: any) => void>();
    const listeners: Array<(m: any) => void> = [];
    socket.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)!(m);
        pending.delete(m.id);
      } else {
        listeners.forEach((l) => l(m));
      }
    };
    const raw = (method: string, params: object = {}, sessionId?: string) =>
      new Promise<any>((resolve, reject) => {
        const id = ++next;
        pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true });
    await raw("Page.enable", {}, sessionId);
    const tab: Tab = {
      send: (method, params) => raw(method, params, sessionId),
      open: async (url) => {
        const loaded = new Promise<void>((resolve) =>
          listeners.push((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId && resolve())
        );
        await raw("Page.navigate", { url }, sessionId);
        await loaded;
      },
    };
    const out = await fn(tab, work);
    await raw("Browser.close").catch(() => {});
    return out;
  } finally {
    ws?.close();
    clearTimeout(timer);
    killTree(child.pid);
    rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Renders `html` (a whole document) to PDF and saves it as `<base>.pdf` in the
 * Downloads folder. Returns the saved path. `html` is tried first; when it
 * overflows a page in this browser and a `fallback` is given, the fallback is
 * printed instead.
 */
export async function savePdf(browser: string, html: string, base: string, fallback?: string): Promise<string> {
  return withTab(browser, RENDER_TIMEOUT_MS, async (tab, work) => {
    const page = path.join(work, "sheet.html");
    await writeFile(page, html);
    await tab.open(pathToFileUrl(page));
    if (fallback) {
      // Evaluated by the protocol, not the page: the page's own policy still
      // forbids every script.
      const { result } = await tab.send("Runtime.evaluate", { expression: OVERFLOWS, returnByValue: true });
      if (result?.value !== false) {
        const alt = path.join(work, "sheet-exact.html");
        await writeFile(alt, fallback);
        await tab.open(pathToFileUrl(alt));
      }
    }
    const { data } = await tab.send("Page.printToPDF", {
      // The sheet's own @page decides the paper; the pages carry their margins.
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: false,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    });
    const target = freeName(downloadsDir(), base.replace(/[^\w.-]+/g, "-"));
    // wx: never overwrite, even if a same-named file appeared since freeName looked.
    await writeFile(target, Buffer.from(data, "base64"), { flag: "wx" });
    return target;
  });
}

const LAYOUT_TIMEOUT_MS = 4 * 60_000;

/**
 * Lays a sheet out in this machine's headless browser — the one that prints
 * it — by opening the app's own layout page (app/sheet-engine) and calling the
 * same paginator and fitter the preview uses. `input` is handed over by the
 * protocol, never fetched by the page, so the page needs no session.
 */
export async function layOutInBrowser<T>(browser: string, engineUrl: string, input: unknown): Promise<T> {
  return withTab(browser, LAYOUT_TIMEOUT_MS, async (tab) => {
    await tab.open(engineUrl);
    for (let i = 0; ; i++) {
      const { result } = await tab.send("Runtime.evaluate", {
        expression: `typeof window.__sheetLayout === "function"`,
        returnByValue: true,
      });
      if (result?.value === true) break;
      if (i > 300) throw new Error("the layout page did not start");
      await new Promise((r) => setTimeout(r, 100));
    }
    const { result, exceptionDetails } = await tab.send("Runtime.evaluate", {
      expression: `window.__sheetLayout(${JSON.stringify(input)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`layout failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value as T;
  });
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
