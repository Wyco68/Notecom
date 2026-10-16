import { NextRequest, NextResponse } from "next/server";
import { deleteDoc, loadDoc, renameDoc } from "@/lib/vault/store";

// notes_documents.title has no DB length constraint; this only stops a client
// handing the handler an enormous string to forward for no legitimate reason.
const MAX_TITLE_LENGTH = 200;

// A stored cheatsheet: its fragment, title and meta (spec, review, the edit
// conversation). Same shape and rules as /api/lesson and /api/quiz.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  try {
    return NextResponse.json(await loadDoc(folder, id, "sheet"));
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  try {
    await deleteDoc(folder, id, "sheet");
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  const body = await req.json().catch(() => null);
  const newTitle = body?.newTitle;
  if (typeof newTitle !== "string" || !newTitle.trim() || newTitle.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: "newTitle required" }, { status: 400 });
  }
  try {
    await renameDoc(folder, id, "sheet", newTitle);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
