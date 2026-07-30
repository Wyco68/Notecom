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
- One concern per `lib/` subfolder: `lib/vault/*` (the Supabase data layer,
  naming, sanitizing, vault import, types), `lib/search/*` (chunking + the
  search RPC client), `lib/claude/*` (Claude client + prompt),
  `lib/auth/*` (Claude Code CLI sign-in — *not* user accounts),
  `lib/supabase/*` (client factories only, no business logic),
  `lib/collab/*` (folder sharing data layer). Don't blend them.
- Database types come from `mcp__supabase__generate_typescript_types` after a
  schema change — don't hand-write row interfaces that will drift.

## SQL (`supabase/migrations/`)
- One file per concern, `NNNN_short_description.sql`, applied in order.
  Append-only: never edit an applied migration, fix forward with a new one.
- Order within a migration set: schema, then functions, then policies.
- Policies call the `notes_can_*` helper predicates rather than subquerying
  the members table; see [collaboration.md](collaboration.md) for why.

## Dependencies
- The app has no Go services any more and should not grow new ones. It also
  has no HTML parser, no search library and no ORM — chunking is a regex over
  a flat, contract-defined fragment, and ranking is SQL. Adding a dependency to
  do either would be re-solving a solved problem in a heavier place.

## Comments
- Default to no comments. Add one only when the *why* isn't obvious from
  the code — a non-obvious constraint, a workaround, a security boundary.
  Never restate what the code already says.
- Existing file-header comments (e.g. `lib/vault/store.ts`,
  `lib/search/chunker.ts`) explain a non-obvious *why* — follow that
  pattern, don't write paragraph docstrings.

## General
- Don't add abstractions, helpers, or config flags for a single call site.
- Don't add error handling for cases that can't happen — only validate at
  real boundaries (user input, the uploaded file, a Supabase error).
- Match existing naming: `camelCase` for TS, `snake_case` for SQL columns and
  functions, kebab-case folder/file slugs in `vault/`.
