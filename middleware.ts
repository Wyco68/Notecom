import { NextRequest, NextResponse } from "next/server";

// Single choke point for the read-only deployments (docs/desktop.md
// read-only notes + docs/deploy-vercel-gcs.md). Blocks every vault-mutating
// request so gating doesn't have to be repeated per route file.
//
// Two flags activate it:
//   READ_ONLY=1        — a read-only reader box (may still have Ollama, so
//                        /api/chat stays allowed).
//   VAULT_SOURCE=gcs   — the serverless GCS deployment: no vaultd, no
//                        Ollama, so writes AND chat are blocked.
export function middleware(req: NextRequest) {
  const readOnly = process.env.READ_ONLY === "1";
  const gcs = process.env.VAULT_SOURCE === "gcs";
  if (!readOnly && !gcs) return NextResponse.next();

  const { pathname } = req.nextUrl;

  // Chat is a local-model feature; it can't work against a GCS backend.
  if (gcs && pathname === "/api/chat") {
    return NextResponse.json({ error: "chat unavailable on this server" }, { status: 403 });
  }
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  // A read-only box that still runs Ollama can serve chat (POST); GCS can't,
  // and was already handled above.
  if (pathname === "/api/chat") return NextResponse.next();
  return NextResponse.json({ error: "read-only server" }, { status: 403 });
}

export const config = {
  matcher: "/api/:path*",
};
