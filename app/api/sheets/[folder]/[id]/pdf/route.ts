import { NextRequest } from "next/server";
import { checkSheetPages } from "@/lib/generate/validate";
import { cliInstalled } from "@/lib/auth/cli";
import { loadDoc, readMedia } from "@/lib/vault/store";
import { LAYOUTS, MAX_COLUMNS, MIN_COLUMNS, printDocument, type SheetMeta } from "@/lib/sheet/layout";
import { findBrowser, savePdf } from "@/lib/sheet/pdf";

// The laid-out pages, as the preview shows them, can't be bigger than this.
const MAX_PAGES_BYTES = 5 * 1024 * 1024;

// Save a stored cheatsheet as a PDF in the reader's Downloads folder, in one
// click. The browser sends the pages it laid out (only a real layout knows
// where a page ends) and the font it settled on; this checks them against the
// sheet allowlist, prints them with a local browser and returns where the file
// went.
//
// Only where the Claude Code CLI is — the reader's own machine, whose
// Downloads folder is theirs. A hosted server answers 501 and the client opens
// the print dialog instead, so it never writes files on anyone's behalf.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  let doc: Awaited<ReturnType<typeof loadDoc>>;
  try {
    doc = await loadDoc(folder, id, "sheet");
  } catch {
    return Response.json({ error: "cheatsheet not found" }, { status: 404 });
  }
  const meta = doc.meta as SheetMeta | null;
  if (!meta?.spec) return Response.json({ error: "cheatsheet has no layout" }, { status: 409 });

  if (Number(req.headers.get("content-length")) > MAX_PAGES_BYTES) {
    return Response.json({ error: "sheet too large to print" }, { status: 413 });
  }
  const body = await req.json().catch(() => null);
  const pages = typeof body?.pages === "string" ? body.pages : "";
  // The font and columns the browser fitted the pages with.
  const font = Number(body?.font);
  const columns = Number(body?.columns);
  const L = LAYOUTS[meta.spec.layout];
  if (
    !pages ||
    pages.length > MAX_PAGES_BYTES ||
    !(font >= L.minFont - 1e-6 && font <= L.maxFont + 1e-6) ||
    !(Number.isInteger(columns) && columns >= MIN_COLUMNS && columns <= MAX_COLUMNS)
  ) {
    return Response.json({ error: "invalid pages, font or columns" }, { status: 400 });
  }
  const problems = checkSheetPages(pages);
  if (problems.length) {
    return Response.json({ error: `the pages contain markup a sheet may not: ${problems[0]}` }, { status: 400 });
  }

  const browser = cliInstalled() ? findBrowser() : null;
  if (!browser) {
    return Response.json(
      { error: "no Chrome, Chromium, Edge or Brave found to print with", fallback: "print" },
      { status: 501 }
    );
  }
  const name = `${folder}-${id}`;
  try {
    const file = await savePdf(browser, printDocument(await inlinePictures(pages), meta.spec.layout, doc.title, font, columns), name);
    return Response.json({ ok: true, path: file });
  } catch (err: any) {
    console.error("[sheet pdf]", err?.message);
    return Response.json({ error: "printing to PDF failed", fallback: "print" }, { status: 502 });
  }
}

/**
 * The printer loads nothing (its document's policy forbids it) and has no
 * session to load with anyway, so each picture goes in as a data: URL, read
 * as the caller — a picture they may not read prints as nothing. Only the
 * /api/media paths checkSheetPages already let through are touched.
 */
async function inlinePictures(pages: string): Promise<string> {
  const srcs = new Set([...pages.matchAll(/\bsrc="(\/api\/media\/[^"]+)"/g)].map((m) => m[1]));
  const read = await Promise.all([...srcs].map(async (src) => [src, await readMedia(src)] as const));
  let out = pages;
  for (const [src, media] of read) {
    const data = media ? `data:${media.type};base64,${media.data.toString("base64")}` : "";
    out = out.split(`src="${src}"`).join(`src="${data}"`);
  }
  return out;
}
