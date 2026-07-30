# /feat

## Purpose
Application development only.

## Load (and only these)
- [docs/architecture.md](../../docs/architecture.md)
- [docs/coding-style.md](../../docs/coding-style.md)
- [docs/ui-guidelines.md](../../docs/ui-guidelines.md)
- [docs/api-contract.md](../../docs/api-contract.md)
- [docs/desktop.md](../../docs/desktop.md) — only when the task touches
  `desktop/`, `scripts/*desktop*`, or app startup/packaging.
- [docs/collaboration.md](../../docs/collaboration.md) — only when the task
  touches folder sharing, roles, membership, tags, folder search, or
  Supabase RLS. Pair it with the `collab` skill
  ([.claude/skills/collab/SKILL.md](../skills/collab/SKILL.md)), which holds
  the migration procedure and the required RLS proof.

Do not load `docs/teaching-guidelines.md`, `docs/html-output-contract.md`,
or `docs/lesson-template.md` — lesson-generation instructions are
irrelevant to application work.

## Responsibilities
- Build new features.
- Improve UI/UX.
- Refactor code.
- Fix bugs.
- Improve performance.
- Improve security.
- Update architecture.
- Write files from the app (`vault/` is generation output — read-only here).
- Modify Next.js (`app/`, `components/`, `lib/`).
- Modify the desktop shell (`desktop/`, `scripts/*desktop*`).
- Documentation, testing, build configuration.

## Restrictions (strict)
- Never generate lessons.
- Never regenerate or rewrite an existing lesson's explanation/content.
- Never edit generated lesson files (`vault/**/*.html`,
  `vault/**/index.json`) unless the task is explicitly a migration or
  format conversion. Generated lessons are application **data**, not
  application source code.

## Redirect rule
If the request belongs to lesson generation, stop and tell the user to use
`/lect`. Do not generate or rewrite lesson content here.

## Verification
After any change: `npx tsc --noEmit` for the Next.js app, `go build` for
the data layer, and a browser check via the preview tools for anything
UI-visible. For anything touching permissions or RLS, those checks prove
nothing on their own — run the RLS proof in the `collab` skill as well.
