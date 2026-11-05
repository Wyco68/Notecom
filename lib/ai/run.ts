// A lesson or quiz written by a web service, run in the reader's browser.
//
// The browser reads the upload, fetches the template from the server, sends
// both to the service with the reader's key, checks the reply against the
// output contract (with up to two fix rounds), and hands only the finished
// HTML to the server to save. The key goes from this tab to the service and
// nowhere else — the app's server never sees it, so no request limit, time
// limit or log on the server can catch it.

import { checkLesson, checkQuiz, extractHtml } from "@/lib/generate/validate";
import { WEB_SERVICES, type WebService } from "./services";
import { AiError, type Turn } from "./core";
import { sourceParts, SourceError } from "./source";

const MAX_FIXES = 2;

export interface WebRunInput {
  file: File;
  folder: string;
  kind: "lect" | "quiz";
  service: WebService;
  key: string;
  model: string;
  signal: AbortSignal;
  log: (line: string) => void;
  tokens: (t: { input: number; output: number }) => void;
}

export async function runWebGeneration(input: WebRunInput): Promise<{ id: string; title: string }> {
  const { file, folder, kind, service, key, model, signal, log } = input;
  const label = WEB_SERVICES[service].label;
  const noun = kind === "quiz" ? "quiz" : "lesson";
  log(`${label} · ${model}`);

  let source;
  try {
    source = await sourceParts(file);
  } catch (err) {
    throw new Error(err instanceof SourceError ? err.message : "That file couldn't be read.");
  }
  log(`Read ${file.name} (${source.summary}).`);

  const tpl = await fetch(`/api/ai/template?kind=${kind}`, { signal });
  const tplBody = await tpl.json().catch(() => ({}));
  if (!tpl.ok || typeof tplBody.system !== "string") throw new Error(tplBody.error || "The lesson template couldn't be loaded.");

  // The adapters (and the Claude SDK) load only when a run starts.
  const { chat } = await import("./chat");

  const turns: Turn[] = [
    {
      role: "user",
      parts: [
        ...source.parts,
        { kind: "text", text: `Write the ${noun} from this source. Reply with only its complete HTML, starting at the <h1>.` },
      ],
    },
  ];
  const total = { input: 0, output: 0 };

  for (let fixes = 0; ; fixes++) {
    log(fixes ? `Asking ${label} to fix it (${fixes} of ${MAX_FIXES}).` : `Writing the ${noun}…`);
    let result;
    try {
      result = await chat({
        service,
        key,
        model,
        system: tplBody.system,
        turns,
        signal,
        onProgress: (chars) => input.tokens({ input: total.input, output: total.output + Math.round(chars / 4) }),
      });
    } catch (err) {
      throw new Error(explain(err, label));
    }
    total.input += result.usage.input;
    total.output += result.usage.output;
    input.tokens({ ...total });

    if (result.truncated) {
      throw new Error("The reply hit the model's output limit and was cut off. Nothing was saved. Try a model with a larger output limit.");
    }
    const html = extractHtml(result.text);
    if (!html) {
      const said = result.text.trim().replace(/\s+/g, " ").slice(0, 300);
      throw new Error(`No ${noun} came back${said ? `. The model said: ${said}` : "."} Nothing was saved.`);
    }
    const violations = kind === "quiz" ? checkQuiz(html) : checkLesson(html);
    if (!violations.length) {
      log("Received the generated HTML.");
      log(`The ${noun} passed the contract check — saving it.`);
      const res = await fetch("/api/generate/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder, kind, html }),
        signal,
      });
      const saved = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Save failed: ${saved.error || `HTTP ${res.status}`}`);
      log(`Saved ${noun} "${saved.title}" to ${folder}.`);
      return { id: saved.id, title: saved.title };
    }

    log(`Contract check failed: ${violations.join("; ")}`);
    if (fixes >= MAX_FIXES) throw new Error(`Still failing after ${fixes} fix attempt(s) — nothing was saved.`);
    turns.push(
      { role: "assistant", parts: [{ kind: "text", text: result.text }] },
      {
        role: "user",
        parts: [
          {
            kind: "text",
            text:
              `The app rejected that ${noun} against its output contract: ` +
              violations.slice(0, 10).map((v) => v.slice(0, 200)).join("; ") +
              `. Fix exactly these problems without changing anything else, and reply with only the complete corrected HTML, starting at the <h1>.`,
          },
        ],
      }
    );
  }
}

function explain(err: unknown, label: string): string {
  if (!(err instanceof AiError)) return `${label} failed. Nothing was saved.`;
  const detail = err.message ? ` (${err.message})` : "";
  switch (err.kind) {
    case "auth":
      return `${label} didn't accept the API key. Check it in the Generate dialog. Nothing was saved.`;
    case "rate":
      return `${label} says the rate limit or quota is used up. Wait a bit, then generate again.${detail}`;
    case "bad-request":
      return `${label} refused the request${detail}. Nothing was saved.`;
    case "refused":
      return "The model declined to write this one. Nothing was saved.";
    case "network":
      // A browser can't read some services' error replies (they drop their
      // CORS headers on a bad key), so "unreachable" may really be "rejected".
      return `Couldn't reach ${label}, or it rejected the key. Nothing was saved — check the key and generate again.`;
    case "aborted":
      return "Stopped.";
    default:
      return `${label} failed${detail}. Nothing was saved.`;
  }
}
