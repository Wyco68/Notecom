import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { randomUUID } from "crypto";
import { startSheetJob } from "@/lib/generate/runner";
import { cliInstalled } from "@/lib/auth/cli";
import { listFolderDocs, loadDoc } from "@/lib/vault/store";
import { layoutFor, MAX_PAGES } from "@/lib/sheet/layout";
import { VERIFIED_USER_HEADER } from "@/middleware";

// A folder slug, never free text — the shape every folder slug has.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
// Slides for the sheet to check the notes against. Same bound as a Generate
// upload, across all of them.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_CHAPTERS = 40;

// Start a cheatsheet run over a range of a folder's lessons. The chapters are
// read here, as the caller under RLS, and handed to the CLI as files: the run
// itself has no database access, so it can only ever see what this request
// could read. The run is followed and stopped through /api/generate/[id] like
// any other job.
export async function POST(req: NextRequest) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return NextResponse.json({ error: "sign in required" }, { status: 401 });

  if (!cliInstalled()) {
    return NextResponse.json(
      { error: "no Claude Code CLI on this server — make cheatsheets from the desktop app or your own checkout instead" },
      { status: 501 }
    );
  }

  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "files too large: keep them under 50 MB together" }, { status: 400 });
  }

  const form = await req.formData();
  const folder = String(form.get("folder") ?? "");
  const from = Number(form.get("from"));
  const to = Number(form.get("to"));
  const pages = Number(form.get("pages"));
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

  if (!SAFE.test(folder)) return NextResponse.json({ error: "invalid folder" }, { status: 400 });
  if (![from, to, pages].every(Number.isInteger) || from < 1 || to < from || pages < 1 || pages > MAX_PAGES) {
    return NextResponse.json({ error: "invalid chapter range or page limit" }, { status: 400 });
  }
  if (to - from + 1 > MAX_CHAPTERS) {
    return NextResponse.json({ error: `at most ${MAX_CHAPTERS} chapters per sheet` }, { status: 400 });
  }
  if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "files too large: keep them under 50 MB together" }, { status: 400 });
  }

  // Reading is enough: a sheet is never saved, so a folder shared with the
  // caller as a viewer is as good a source as one they own.
  const { lessons } = await listFolderDocs(folder);
  const chosen = lessons.filter((l) => l.seq >= from && l.seq <= to);
  if (!chosen.length) {
    return NextResponse.json({ error: "no lessons in that range" }, { status: 404 });
  }

  const dir = path.join(tmpdir(), "notes-sheets", randomUUID());
  await mkdir(dir, { recursive: true });
  const chapters: Array<{ seq: number; path: string }> = [];
  for (const l of chosen) {
    const { html, title } = await loadDoc(folder, l.id, "lesson");
    const file = path.join(dir, `ch${String(l.seq).padStart(2, "0")}.html`);
    // One block per line: Read cuts very long lines, and a lesson is often
    // stored as one.
    const body = html.replace(/(<(?:h[1-6]|p|li|tr|table|ul|ol|pre|blockquote|div)[\s>])/g, "\n$1");
    await writeFile(file, `<!-- chapter ${l.seq} -->\n<h1>${l.seq}. ${escapeText(title)}</h1>\n${body}\n`);
    chapters.push({ seq: l.seq, path: file });
  }
  const extras: string[] = [];
  for (const [i, f] of files.entries()) {
    const file = path.join(dir, `source-${i + 1}-${f.name.replace(/[^\w.-]/g, "_")}`);
    await writeFile(file, Buffer.from(await f.arrayBuffer()));
    extras.push(file);
  }

  const first = chosen[0].seq;
  const last = chosen[chosen.length - 1].seq;
  const job = startSheetJob(
    folder,
    { from: first, to: last, pages, layout: layoutFor(pages), title: `${folder}-cheatsheet-ch${first}-${last}` },
    dir,
    chapters,
    extras,
    userId
  );
  return NextResponse.json({ jobId: job.id, sheet: job.sheet });
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
