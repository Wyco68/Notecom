import { NextRequest, NextResponse } from "next/server";

// Single choke point for a read-only box (READ_ONLY=1): blocks every
// vault-mutating request so gating doesn't have to be repeated per route
// file. Two exceptions:
//   - /api/chat: a read-only box may still run Ollama.
//   - /api/collab: these write membership, not note content. A hosted reader
//     is read-only about lessons; sharing them is the point of it being
//     hosted. Every collab route is guarded by RLS regardless.
export function middleware(req: NextRequest) {
  if (process.env.READ_ONLY !== "1") return NextResponse.next();
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (path === "/api/chat" || path.startsWith("/api/collab/")) return NextResponse.next();
  return NextResponse.json({ error: "read-only server" }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
