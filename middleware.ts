import { NextRequest, NextResponse } from "next/server";

// Single choke point for a read-only box (READ_ONLY=1): blocks every
// vault-mutating request so gating doesn't have to be repeated per route
// file. Chat stays allowed — a read-only box may still run Ollama.
export function middleware(req: NextRequest) {
  if (process.env.READ_ONLY !== "1") return NextResponse.next();
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  if (req.nextUrl.pathname === "/api/chat") return NextResponse.next();
  return NextResponse.json({ error: "read-only server" }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
