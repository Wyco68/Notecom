import { NextRequest, NextResponse } from "next/server";
import { deleteQuiz, loadQuiz, renameQuiz } from "@/lib/vault/helper";

// notes_documents.title has no DB length constraint; this only stops a client
// handing the handler an enormous string to forward for no legitimate reason.
const MAX_TITLE_LENGTH = 200;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ folder: string; id: string }> }
) {
  const { folder, id } = await params;
  try {
    const data = await loadQuiz(folder, id);
    return NextResponse.json(data);
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
    await deleteQuiz(folder, id);
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
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const { newTitle } = body;
    if (typeof newTitle !== "string" || !newTitle.trim() || newTitle.length > MAX_TITLE_LENGTH) {
      return NextResponse.json({ error: "newTitle required" }, { status: 400 });
    }
    await renameQuiz(folder, id, newTitle);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
