"use client";

import { useId, useRef, useState } from "react";
import UploadIcon from "../icons/UploadIcon";
import FileIcon from "../icons/FileIcon";
import CloseIcon from "../icons/CloseIcon";

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Every upload in the app: a drop target that is also a button. A real
// <input type="file"> sits under the label, so the keyboard, the OS picker
// and screen readers all get the native control.
export default function FileDrop({
  files,
  onChange,
  multiple = false,
  hint = "PDF, slides, document, image or Markdown",
  label = "Drop a file or browse",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  hint?: string;
  label?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);

  function take(list: FileList | null) {
    const picked = [...(list ?? [])];
    if (!picked.length) return;
    onChange(multiple ? [...files, ...picked] : picked.slice(0, 1));
  }

  return (
    <div>
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors duration-150 ease-out focus-within:ring-2 focus-within:ring-accent/60 ${
          over ? "border-accent bg-accent/[0.06]" : "border-ink/25 hover:border-accent/60 hover:bg-ink/[0.02]"
        }`}
      >
        <UploadIcon className={`mb-1 h-5 w-5 ${over ? "text-accent" : "text-muted"}`} />
        <span className="text-sm font-medium text-ink">{label}</span>
        <span className="text-xs text-muted">{hint}</span>
        <input
          ref={input}
          id={id}
          type="file"
          multiple={multiple}
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
          className="sr-only"
        />
      </label>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md bg-cover/70 px-2.5 py-1.5 text-sm">
              <FileIcon className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
              <span data-numeric className="shrink-0 text-xs text-muted">
                {size(f.size)}
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                title="Remove"
                aria-label={`Remove ${f.name}`}
                className="ui-icon-btn h-5 w-5"
              >
                <CloseIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
