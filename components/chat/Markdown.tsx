import { Fragment, type ReactNode } from "react";

// Minimal, dependency-free Markdown renderer for chat answers. The local
// model is told (in indexd's chat system prompt) to reply in Markdown so
// its answers read like the lessons; this turns that Markdown into the same
// prose-styled elements the lesson reader uses. It supports only the subset
// the model is asked to produce — headings, bold/italic/code, and bullet or
// ordered lists — and re-parses the whole string on every streamed token,
// which is fine at chat length.

// Inline spans: **bold**, *italic*, `code`. Split on the first matching
// delimiter and recurse so nesting-free combinations render correctly.
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<em key={key}>{m[3]}</em>);
    else if (m[4] !== undefined) out.push(<code key={key}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block: ``` … ``` -> <pre><code>. A fence left unclosed
    // mid-stream still renders as code up to the current token.
    if (/^\s*```/.test(line)) {
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      blocks.push(
        <pre key={key++}>
          <code>{code.join("\n")}</code>
        </pre>
      );
      continue;
    }

    // Heading: 1–6 `#` -> h2/h3/h4 (prose styles these like lessons; the
    // model sometimes goes as deep as ####, all collapse to h4 and below).
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h${key}`);
      blocks.push(
        level === 1 ? (
          <h2 key={key++}>{content}</h2>
        ) : level === 2 ? (
          <h3 key={key++}>{content}</h3>
        ) : (
          <h4 key={key++}>{content}</h4>
        )
      );
      i++;
      continue;
    }

    // Bullet list: consecutive `- ` / `* ` lines.
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*[-*]\s+/, "");
        items.push(<li key={items.length}>{renderInline(item, `ul${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    // Ordered list: consecutive `1.` / `2.` … lines.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const item = lines[i].replace(/^\s*\d+\.\s+/, "");
        items.push(<li key={items.length}>{renderInline(item, `ol${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    // Blank line: block separator, nothing to emit.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: gather until a blank line or a block-starting line.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|\s*[-*]\s|\s*\d+\.\s|\s*```)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(l, `p${key}-${j}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:my-2 prose-headings:mb-1 prose-headings:mt-3">
      {blocks}
    </div>
  );
}
