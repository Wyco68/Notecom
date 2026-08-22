import { NextRequest, NextResponse } from "next/server";
import { deleteFolder, listFolderDocs, renameFolder } from "@/lib/vault/helper";

// notes_folders.name has no DB length constraint; this only stops a client
// handing the handler an enormous string to forward for no legitimate reason.
const MAX_NAME_LENGTH = 200;

// One folder's lessons and quizzes, fetched when the reader opens it rather
// than with the tree — see the note in lib/vault/store.ts. An unreadable or
// missing folder answers with empty lists, not a 404: which folders exist is
// exactly what RLS is hiding.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    const res = NextResponse.json(await listFolderDocs(name));
    // Per-user (RLS-scoped) data — `private` only. Every current caller opens
    // this on a deliberate action (folder opened, manual refresh, a
    // generation run finishing) and asks for `no-store`, so this header is
    // inert today; it's here so a future low-stakes caller isn't forced to
    // hit Supabase fresh on every request the way this route does now.
    res.headers.set("Cache-Control", "private, max-age=0, stale-while-revalidate=20");
    return res;
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    await deleteFolder(name);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const { newName } = body;
    if (typeof newName !== "string" || !newName.trim() || newName.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "newName required" }, { status: 400 });
    }
    await renameFolder(name, newName);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
