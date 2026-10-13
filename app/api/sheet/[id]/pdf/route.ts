import { NextRequest } from "next/server";
import { getJob } from "@/lib/generate/runner";
import { checkSheetPages } from "@/lib/generate/validate";
import { LAYOUTS, printDocument } from "@/lib/sheet/layout";
import { findBrowser, savePdf } from "@/lib/sheet/pdf";
import { VERIFIED_USER_HEADER } from "@/middleware";

// The laid-out pages, as the preview shows them, can't be bigger than this.
const MAX_PAGES_BYTES = 5 * 1024 * 1024;

// Save a finished cheatsheet as a PDF in the reader's Downloads folder, in one
// click. The browser sends the pages it laid out (layout is the browser's job:
// only a real layout knows where a page ends) and the font it settled on; this
// checks them against the sheet allowlist, prints them with a local browser
// and returns where the file went. 501 when no browser is installed — the
// client then falls back to the print dialog.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = req.headers.get(VERIFIED_USER_HEADER);
  if (!userId) return Response.json({ error: "sign in required" }, { status: 401 });
  const { id } = await params;
  const job = getJob(id, userId);
  if (!job || job.kind !== "sheet" || !job.sheet) {
    return Response.json({ error: "cheatsheet not found" }, { status: 404 });
  }
  if (job.status !== "done") return Response.json({ error: "cheatsheet not ready" }, { status: 409 });

  if (Number(req.headers.get("content-length")) > MAX_PAGES_BYTES) {
    return Response.json({ error: "sheet too large to print" }, { status: 413 });
  }
  const body = await req.json().catch(() => null);
  const pages = typeof body?.pages === "string" ? body.pages : "";
  const font = Number(body?.font);
  const L = LAYOUTS[job.sheet.layout];
  if (!pages || pages.length > MAX_PAGES_BYTES || !(font >= L.minFont - 1e-6 && font <= L.font + 1e-6)) {
    return Response.json({ error: "invalid pages or font" }, { status: 400 });
  }
  const problems = checkSheetPages(pages);
  if (problems.length) {
    return Response.json({ error: `the pages contain markup a sheet may not: ${problems[0]}` }, { status: 400 });
  }

  const browser = findBrowser();
  if (!browser) {
    return Response.json(
      { error: "no Chrome, Chromium, Edge or Brave found to print with", fallback: "print" },
      { status: 501 }
    );
  }
  try {
    const file = await savePdf(browser, printDocument(pages, job.sheet.layout, job.sheet.title, font), job.sheet.title);
    return Response.json({ ok: true, path: file });
  } catch (err: any) {
    console.error("[sheet pdf]", err?.message);
    return Response.json({ error: "printing to PDF failed", fallback: "print" }, { status: 502 });
  }
}
