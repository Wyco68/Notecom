# CLAUDE.md

Global repository rules only. No lesson-generation instructions, no
implementation details — those live in the two command files and `docs/`.

## Repo purpose
Lesson notes generated from uploaded slides/PDFs/images, rewritten in plain
high-school-level language, technical terms kept correct (Information
Systems & Network Engineering program). Architecture: `docs/architecture.md`.
Repo rules for humans: [README.md](README.md).

## The three commands
Optional, not required: a request works without one. Each command loads a
focused doc set, so naming one is the fast path when the work clearly belongs
to it. Without a command, work out from the request which set applies and load
that — the split below still says which docs belong to which kind of work.

- **`/lect`** — [.claude/commands/lect.md](.claude/commands/lect.md).
  Lesson generation and maintenance only. Loads only
  `docs/teaching-guidelines.md`, `docs/html-output-contract.md`,
  `docs/lesson-template.md`.
- **`/quiz`** — [.claude/commands/quiz.md](.claude/commands/quiz.md).
  Quiz creation and maintenance only. Loads only `docs/quiz-guidelines.md`.
- **`/feat`** — [.claude/commands/feat.md](.claude/commands/feat.md).
  Application development only. Loads only `docs/architecture.md`,
  `docs/coding-style.md`, `docs/ui-guidelines.md`, `docs/api-contract.md`,
  plus `docs/collaboration.md` when the task touches folder sharing,
  permissions or RLS.

## Never mix responsibilities (strict)
Content work and application work stay separate changes. Lesson/quiz
generation follows the teaching docs; application work follows the
architecture docs. Doing both in one pass mixes two contracts that disagree
about what the vault is — split them.

Generated lesson/quiz files (`vault/**/*.html`, `vault/**/index.json`,
`vault/.quiz-state.json`) are **application data**, not application source.
Application work never edits them except for an explicit, requested migration
or format conversion.

## Caveman mode scope
Caveman mode (ultra): use aggressive for dev work (`/feat`, code edits, debugging,
chat replies). Never for generated files — lesson HTML (`/lect`), quiz content
(`/quiz`), commits, PRs. Those stay full normal prose per their own docs.

## Collaboration and access control
Folders are the unit of sharing: owner, members with roles, visibility, tags.
Documents inherit folder permissions and never carry their own. Access is enforced by Supabase Row Level Security — no
service-role key exists in this app, and a frontend check is never the
protection. Contract: [docs/collaboration.md](docs/collaboration.md).
