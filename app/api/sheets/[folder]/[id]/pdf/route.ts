import { NextRequest } from "next/server";
import { checkSheetPages } from "@/lib/generate/validate";
import { cliInstalled } from "@/lib/auth/cli";
import { loadDoc } from "@/lib/vault/store";
import { inlinePictures, layoutKey } from "@/lib/sheet/device-layout";
import { LAYOUTS, MAX_COLUMNS, MIN_COLUMNS, printDocument, type SheetMeta } from "@/lib/sheet/layout";
import { findBrowser, savePdf } from "@/lib/sheet/pdf";

// The laid-out pages, as the preview shows them, can't be bigger than this.
const MAX_PAGES_BYTES = 5 * 1024 * 1024;

// Save a stored cheatsheet as a PDF in the reader's Downloads folder, in one
// click. With `{ stored: true }` it prints the layout stored with the sheet,
// made on this machine by the same browser that prints it
// (lib/sheet/device-layout.ts), so the PDF is that layout exactly. Otherwise
// the browser sends the pages it laid out and the font it settled on. Either
// way the pages are checked against the sheet allowlist before printing.
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
  const stored = body?.stored === true;
  if (stored && meta.layout?.key !== layoutKey(doc.html, meta.spec)) {
    return Response.json({ error: "the stored layout is out of date — reopen the sheet to lay it out again" }, { status: 409 });
  }
  const pages = stored ? meta.layout!.html : typeof body?.pages === "string" ? body.pages : "";
  // The font and columns the pages were fitted with.
  const font = Number(stored ? meta.layout!.font : body?.font);
  const columns = Number(stored ? meta.layout!.columns : body?.columns);
  const lh = Number(stored ? meta.layout!.lineHeight ?? 1.17 : body?.lineHeight ?? 1.17);
  const lineHeight = lh >= 1 && lh <= 1.5 ? lh : 1.17;
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
    const inlined = (await inlinePictures(pages)).html;
    if (stored) {
      // Laid out by this very browser: print it as it is.
      const file = await savePdf(browser, printDocument(inlined, meta.spec.layout, doc.title, font, columns, false, lineHeight), name);
      return Response.json({ ok: true, path: file });
    }
    // The browser that laid the pages out (WebKit, in the Linux app) and the
    // one printing them (Chromium) measure text a little differently, so the
    // column breaks the paginator forced to keep a heading with its text
    // leave empty stretches in print. Chromium keeps headings with their text
    // by itself (break-after: avoid), so print without those breaks — unless
    // that overflows a page here, then exactly as laid out.
    const free = inlined.replace(/\sstyle="break-before:\s*column;?"/g, "");
    const file = await savePdf(
      browser,
      printDocument(free, meta.spec.layout, doc.title, font, columns, false, lineHeight),
      name,
      printDocument(inlined, meta.spec.layout, doc.title, font, columns, false, lineHeight)
    );
    return Response.json({ ok: true, path: file });
  } catch (err: any) {
    console.error("[sheet pdf]", err?.message);
    return Response.json({ error: "printing to PDF failed", fallback: "print" }, { status: 502 });
  }
}
