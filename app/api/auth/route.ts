import { NextRequest, NextResponse } from "next/server";
import { readStatus, startLogin, submitCode, cancelLogin, logout } from "@/lib/auth/cli";

// Sign-in for the local Claude Code CLI. Everything here is a thin shell
// around the CLI's own auth commands — see lib/auth/cli.ts for why the app
// never holds the credential itself.

// Signing the CLI in is how a user makes generation work on their own machine,
// so it is never gated: an instance either has a local CLI to sign in (and the
// flow works) or it does not (and the CLI's own commands fail, with a message
// saying so). A server-wide flag added nothing that reality doesn't already say.

// The pasted login code is a handful of characters at most; this only stops a
// client writing an enormous string to the CLI child process's stdin.
const MAX_CODE_LENGTH = 200;

export async function GET() {
  return NextResponse.json(await readStatus());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "login");

  if (action === "code") {
    const code = String(body.code ?? "");
    if (!code.trim() || code.length > MAX_CODE_LENGTH) {
      return NextResponse.json({ error: "code required" }, { status: 400 });
    }
    if (!submitCode(code)) {
      return NextResponse.json({ error: "no login is waiting for a code" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "logout") {
    return NextResponse.json({ ok: await logout() });
  }

  const mode = body.mode === "console" ? "console" : "claudeai";
  startLogin(mode);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  return cancelLogin()
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "no login in progress" }, { status: 409 });
}
