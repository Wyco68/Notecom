import { NextRequest, NextResponse } from "next/server";
import { readStatus, startLogin, submitCode, cancelLogin, logout } from "@/lib/auth/cli";

// Sign-in for the local Claude Code CLI. Everything here is a thin shell
// around the CLI's own auth commands — see lib/auth/cli.ts for why the app
// never holds the credential itself.

// A read-only box has no business starting a login flow on the machine it
// runs on; same guard the generate routes use.
const writesDisabled = () => process.env.READ_ONLY === "1";

export async function GET() {
  return NextResponse.json(await readStatus());
}

export async function POST(req: NextRequest) {
  if (writesDisabled()) {
    return NextResponse.json({ error: "sign-in disabled on this server" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "login");

  if (action === "code") {
    const code = String(body.code ?? "");
    if (!code.trim()) {
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
  if (writesDisabled()) {
    return NextResponse.json({ error: "sign-in disabled on this server" }, { status: 403 });
  }
  return cancelLogin()
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "no login in progress" }, { status: 409 });
}
