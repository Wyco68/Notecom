import type { Metadata } from "next";

// Reachable in ordinary use, not just by mistyping: `/vault/<folder>` has no
// page of its own (folders open inside the workspace, not at their own route),
// so a stale bookmark to one lands here. It says where the reader is and gives
// them the two doors back rather than the framework's bare default.

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-gray-400 dark:text-gray-600">
        404
      </p>
      <h1 className="mb-2 text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
        That page isn&apos;t here
      </h1>
      <p className="mb-8 text-sm text-gray-500 dark:text-gray-400">
        The link may be out of date, or the folder it pointed at was renamed or
        deleted. Folders open inside the vault rather than at their own address.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href="/vault" className="ui-btn ui-btn-primary px-4">
          Back to vault
        </a>
        <a href="/discover" className="ui-btn ui-btn-secondary px-4 font-normal">
          Discover folders
        </a>
      </div>
    </main>
  );
}
