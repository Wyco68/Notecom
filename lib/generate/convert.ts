// Turns Office's pre-2007 binary formats (.ppt, .doc, .xls) into their XML
// successors before a run, because the markitdown tool reads only the latter:
// handed a .ppt, it fails and the run stops with nothing to write from.
//
// The converter is LibreOffice, when the machine has it; the app ships none.
// Without it the upload is refused up front with what to do instead, rather
// than after a run has started.
//
// The work happens in a folder under the home directory, not the OS temp dir:
// the snap build of LibreOffice (Ubuntu's default) has a private /tmp and
// cannot see a file there. It gets its own profile in that folder as well, so
// a LibreOffice window the reader already has open can't swallow the job.

import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { copyFile, mkdir, rm, rmdir } from "fs/promises";
import { homedir } from "os";
import path from "path";
import { pathToFileURL } from "url";

const CONVERT_TIMEOUT_MS = 3 * 60_000;
const LEGACY: Record<string, string> = { ".ppt": "pptx", ".doc": "docx", ".xls": "xlsx" };

export function isLegacyOffice(name: string): boolean {
  return path.extname(name).toLowerCase() in LEGACY;
}

/** LibreOffice's soffice on this machine, or null. */
function findSoffice(): string | null {
  const candidates: string[] = [];
  if (process.platform === "win32") {
    for (const r of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]].filter(Boolean) as string[]) {
      candidates.push(path.join(r, "LibreOffice", "program", "soffice.exe"));
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  } else {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      candidates.push(path.join(dir, "soffice"), path.join(dir, "libreoffice"));
    }
    // A desktop launcher's PATH often lacks /snap/bin.
    candidates.push("/usr/bin/soffice", "/usr/bin/libreoffice", "/snap/bin/libreoffice");
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/**
 * Converts a legacy Office file to its modern format beside the original,
 * deletes the original and returns the new path. Throws an error whose message
 * is fit to show the reader.
 */
export async function convertLegacyOffice(file: string, shownName: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const target = LEGACY[ext];
  const advice = `save it as .${target} or PDF and upload that`;
  const soffice = findSoffice();
  if (!soffice) {
    throw new Error(`${shownName} is an old ${ext} file the app can't read: ${advice}, or install LibreOffice so the app can convert it`);
  }

  const root = path.join(homedir(), "Notecom-convert");
  const work = path.join(root, randomUUID());
  await mkdir(work, { recursive: true });
  try {
    const input = path.join(work, `upload${ext}`);
    await copyFile(file, input);
    const ok = await run(soffice, [
      "--headless",
      `-env:UserInstallation=${pathToFileURL(path.join(work, "profile")).href}`,
      "--convert-to",
      target,
      "--outdir",
      work,
      input,
    ]);
    const output = path.join(work, `upload.${target}`);
    if (!ok || !existsSync(output)) throw new Error(`LibreOffice could not convert ${shownName}: ${advice}`);

    const converted = file.slice(0, -ext.length) + `.${target}`;
    await copyFile(output, converted);
    await rm(file, { force: true });
    return converted;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    // Only goes when no other conversion is using it.
    await rmdir(root).catch(() => {});
  }
}

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    // Its own process group, so a timeout takes the whole office suite with
    // it — the snap and distro launchers are shell scripts.
    const child = spawn(cmd, args, { stdio: "ignore", detached: process.platform !== "win32", windowsHide: true });
    const timer = setTimeout(() => {
      try {
        if (process.platform === "win32") child.kill();
        else process.kill(-child.pid!, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, CONVERT_TIMEOUT_MS);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
