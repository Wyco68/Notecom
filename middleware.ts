import { NextRequest, NextResponse } from "next/server";

// Single choke point for the read-only reader deployment (see
// docs/desktop.md deployment notes): blocks every vault-mutating request
// so gating doesn't have to be repeated per route file. /api/chat is POST
// but never writes to the vault (it's a passthrough to indexd/Ollama), so
// it's exempt.
export function middleware(req: NextRequest) {
  if (process.env.READ_ONLY !== "1") return NextResponse.next();
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  if (req.nextUrl.pathname === "/api/chat") return NextResponse.next();
  return NextResponse.json({ error: "read-only server" }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
