import { NextRequest, NextResponse } from "next/server";
import { createFolder } from "@/lib/vault/helper";
import { slugify } from "@/lib/vault/slug";

// Neither notes_folders.name nor .title has a DB length constraint, so this
// caps only against a client handing the handler an enormous string to
// slugify and forward for no legitimate reason — not a business rule.
const MAX_NAME_LENGTH = 200;

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const { name } = body;
    if (!name || typeof name !== "string" || name.length > MAX_NAME_LENGTH) {
      return NextResponse.json({ error: "folder name required" }, { status: 400 });
    }
    const folder = slugify(name);
    await createFolder(folder);
    return NextResponse.json({ ok: true, folder });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
