# Coding Style

Loaded by `/feat` only. Conventions already in use across this repo —
match them, don't introduce a second style.

## TypeScript / Next.js
- Strict TS (`tsconfig.json` has `strict: true`). No `any` unless catching
  an error (`catch (err: any)` is the one accepted exception, matching
  existing route handlers).
- App Router only (`app/`), route handlers as `route.ts` with named
  `GET`/`POST`/`DELETE` exports.
- Client components get an explicit `"use client"` at the top; server
  components (route handlers, layout) don't.
- Path alias `@/*` maps to repo root — use it (`@/lib/vault/helper`), not
  deep relative imports, except for same-folder/sibling imports
  (`./Modal`, `../sidebar/FileTree`).
- One concern per `lib/` subfolder: `lib/vault/*` (naming, sanitizing,
  vaultd client, types), `lib/claude/*` (Claude client + prompt),
  `lib/auth/*` (Claude Code CLI sign-in — *not* user accounts),
  `lib/supabase/*` (client factories only, no business logic),
  `lib/collab/*` (folder sharing data layer). Don't blend them.
- Database types come from `mcp__supabase__generate_typescript_types` after a
  schema change — don't hand-write row interfaces that will drift.

## SQL (`supabase/migrations/`)
- One file per concern, `NNNN_short_description.sql`, applied in order.
  Append-only: never edit an applied migration, fix forward with a new one —
  same discipline as `tools/stored/migrations.go`.
- Order within a migration set: schema, then functions, then policies.
- Policies call the `notes_can_*` helper predicates rather than subquerying
  the members table; see [collaboration.md](collaboration.md) for why.

## Go (`tools/vaultd`)
- Single `main.go`, stdlib only (`net/http`, `encoding/json`,
  `os`/`path/filepath`) — no framework, no third-party deps. Keep it that
  way; the whole point of the Go helper is that it's small and dumb (see
  [architecture.md](architecture.md)).
- Every handler validates path-safety via `safeName()` before touching the
  filesystem. Any new endpoint that takes a name/id from the request must
  do the same.

## Go (`tools/indexd`)
- Separate module. Exactly two direct deps, each earning its place:
  `modernc.org/sqlite` (pure-Go driver — no CGO, so Windows builds don't
  need a C toolchain) and `golang.org/x/net/html` (real HTML parsing for
  the chunker). Don't add more; in particular no vector-DB client and no
  HTTP framework.
- Same `safeName()` rule as vaultd for every folder/id from a request.

## Comments
- Default to no comments. Add one only when the *why* isn't obvious from
  the code — a non-obvious constraint, a workaround, a security boundary.
  Never restate what the code already says.
- Existing file-header comments (e.g. `lib/vault/sanitize.ts`,
  `tools/vaultd/main.go`) explain a non-obvious *why* — follow that
  pattern, don't write paragraph docstrings.

## General
- Don't add abstractions, helpers, or config flags for a single call site.
- Don't add error handling for cases that can't happen — only validate at
  real boundaries (user input, the uploaded file, the vaultd HTTP
  response).
- Match existing naming: `camelCase` for TS, `PascalCase` exported Go
  funcs/types, kebab-case folder/file slugs in `vault/`.
