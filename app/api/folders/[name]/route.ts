import { NextRequest, NextResponse } from "next/server";
import { deleteFolder, listFolderDocs } from "@/lib/vault/helper";

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
    return NextResponse.json(await listFolderDocs(name));
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
