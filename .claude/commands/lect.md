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
- Regenerate an existing lesson.
- Improve lesson quality.
- Update the explanation format/content.
- Save generated lesson files to `vault/`.

## Strict flow (run in this exact order)

1. **Resolve folder name.** The text after `/lect` (e.g. `/lect Wireless
   Network`) names the **destination folder/subject**, nothing else — it is
   never a claim about file content and must never be checked against the
   file. List existing folders under `vault/` and compare:
   - Exact or obvious shortcut/typo match (e.g. case, abbreviation, minor
     misspelling) of an existing folder → use that existing folder.
   - No reasonable match → ask the user (one question): create this as a
     **new** folder, or did they mean to **retype** the name to match an
     existing one? Do not guess silently either way.
   - Never validate the folder name against the uploaded file's actual topic.
     A mismatch between folder name and file content is expected and fine.

2. **Convert via markitdown.** The uploaded file is already attached to the
   conversation — never search the filesystem (`Glob`/`find`/etc.) for it,
   read the attachment directly. Every uploaded file (PDF, PPTX, DOCX, image,
   etc.) must go through the `markitdown` MCP server before you write a
   single word of lesson content. Convert the upload to Markdown, then read
   every point from that Markdown output — don't eyeball the raw file's
   rendering and don't skip conversion because the file "looks simple."

   This exists because raw PDFs/slides garble text extraction (column order,
   embedded tables, image-only text) in ways that are easy to miss but
   corrupt the lesson — markitdown's output is the reliable source of truth.

   If the `markitdown` tool isn't available in this session (not connected —
   check the tool list), say so explicitly and ask the user to restart the
   session so `.mcp.json` picks it up, rather than silently falling back to
   reading the raw file yourself.

3. **Generate the lesson** from the markitdown output, per
   [teaching-guidelines.md](../../docs/teaching-guidelines.md) and
   [lesson-template.md](../../docs/lesson-template.md). Lesson **title**
   always comes from the real file content, never from the `/lect` argument.

4. **Save** into the folder resolved in step 1 — see Save path below.

## Save path (direct file writes)

The web application no longer handles generation. Write lesson files directly:

```
vault/<folder-slug>/<id>.html   ← the generated semantic HTML
vault/<folder-slug>/index.json  ← upsert the lesson entry
```

**Naming rules (must follow):**
- `<folder-slug>` = subject name lowercased, non-alphanumerics → `-`, trimmed
- `<slug>` = lesson title lowercased, non-alphanumerics → `-`, trimmed
- `<seq>` = max existing `seq` in `index.json` + 1 (start at 1 if folder is new)
- `<id>` = `String(seq).padStart(2, "0") + "-" + slug`, e.g. `"03-routing-protocols"`

**index.json entry shape:**
```json
{ "id": "03-routing-protocols", "slug": "routing-protocols", "title": "Routing Protocols", "seq": 3 }
```

When the folder does not exist yet, create the directory and a new `index.json`
containing just the one entry. When the folder exists, read the current
`index.json`, append (or update) the entry, and write it back.

## After saving (validate)
After writing/updating a lesson's `.html`, **before** touching `index.json`,
validate it against the contract:

```
node scripts/validate-lesson.mjs vault/<folder-slug>/<id>.html
```

If it reports violations, fix the HTML and re-run until it passes — do not
save a lesson that fails validation. This is the strict-rules enforcement
for [html-output-contract.md](../../docs/html-output-contract.md): the
contract drifted silently before (bare `Concept` headings, duplicate
`Exam Tips`/`Remember` headings, a missing `<h1>` title) and nobody
noticed until a user did. The validator exists so that never happens
again without being caught immediately.

Once it passes, update `index.json`. That is the final step — do **not**
open a browser or start the web app. The Notes app picks up the new lesson
on its own: it refreshes when its window regains focus, and there's a
refresh button next to the theme toggle for an immediate reload.

## Restrictions (strict)
- Never modify application code (`app/`, `components/`, `lib/`, `tools/`).
- Never modify the UI.
- Never refactor the project.
- Never install packages.
- Never change the project architecture.
- Never update documentation unless explicitly requested.
- Never write Markdown — lesson output is HTML only (see html-output-contract.md).

## Redirect rule
If the request is about the application instead of lesson content, stop
and tell the user to use `/feat`. Do not do app work here.
