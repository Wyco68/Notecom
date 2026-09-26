# /lect

## Purpose
Lesson content creation and maintenance only.

## Load (and only these)
- [docs/teaching-guidelines.md](../../docs/teaching-guidelines.md)
- [docs/html-output-contract.md](../../docs/html-output-contract.md)
- [docs/lesson-template.md](../../docs/lesson-template.md)

Do not load `docs/architecture.md`, `docs/coding-style.md`,
`docs/ui-guidelines.md`, or `docs/api-contract.md` unless a lesson task
genuinely needs to know the storage layout (the three docs above are normally enough).

## Responsibilities
- Generate a lesson from an uploaded lecture file.
- Improve lesson quality and the explanation format/content.
- Reply with the lesson HTML. **Saving is not yours:** the Notecom app
  checks the reply against the contract, names and numbers the lesson, and
  saves it to Supabase. You never write a file.

## Strict flow (run in this exact order)

1. **Destination is not yours to resolve.** The folder was chosen in the
   app's Generate dialog and the app files the lesson there. Any text after
   `/lect` is never a claim about file content and must never be checked
   against the file. Don't look for `vault/`, `index.json` or other lessons.

2. **Convert via markitdown.** The uploaded file's path is given in the
   prompt — never search the filesystem (`Glob`/`find`/etc.) for it. Every
   uploaded file (PDF, PPTX, DOCX, image, etc.) must go through the
   `markitdown` MCP server before you write a single word of lesson content.
   Convert the upload to Markdown, then read every point from that Markdown
   output — don't eyeball the raw file's rendering and don't skip conversion
   because the file "looks simple."

   This exists because raw PDFs/slides garble text extraction (column order,
   embedded tables, image-only text) in ways that are easy to miss but
   corrupt the lesson — markitdown's output is the reliable source of truth.

   If the `markitdown` tool isn't available in this session (not connected —
   check the tool list), say so explicitly and stop, rather than silently
   falling back to reading the raw file yourself.

3. **Generate the lesson** from the markitdown output, per
   [teaching-guidelines.md](../../docs/teaching-guidelines.md) and
   [lesson-template.md](../../docs/lesson-template.md). Lesson **title**
   always comes from the real file content, never from the `/lect` argument
   — it is the one `<h1>`, and the app takes the lesson's name from it.

4. **Reply with the HTML only** — the complete lesson, starting at the
   `<h1>`, with no code fence and no text before or after it. The reply *is*
   the output: the app extracts the document from it.

## What the app does with the reply
- Checks it against [html-output-contract.md](../../docs/html-output-contract.md)
  (`lib/generate/validate.ts`). On a violation it resumes this session with
  the list — fix exactly those problems and reply with the complete
  corrected HTML again, same rules as step 4. Nothing is saved until it
  passes.
- Names it (`<seq>-<slug>`, from the `<h1>` and the folder's existing
  lessons) and saves it to Supabase. You compute none of that.

## Restrictions (strict)
- Never modify application code (`app/`, `components/`, `lib/`, `tools/`).
- Never modify the UI.
- Never refactor the project.
- Never write, create or edit any file or folder — the run only has read
  access, and the reply is the only output.
- Never install packages.
- Never change the project architecture.
- Never update documentation unless explicitly requested.
- Never write Markdown — lesson output is HTML only (see html-output-contract.md).

## Redirect rule
If the request is about the application instead of lesson content, stop
and tell the user to use `/feat`. Do not do app work here.
