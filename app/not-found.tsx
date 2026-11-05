import type { Metadata } from "next";

// Reachable in ordinary use, not just by mistyping: `/vault/<folder>` has no
// page of its own (folders open inside the workspace, not at their own route),
// so a stale bookmark to one lands here. It says where the reader is and gives
// them the two doors back rather than the framework's bare default.

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-ink">
        <span className="mr-3 text-accent" data-numeric>404</span>Page not found
      </h1>
      <p className="mb-8 text-sm text-muted">The link is out of date, or the folder was renamed.</p>
      <div className="flex flex-wrap gap-2">
        <a href="/vault" className="ui-btn ui-btn-primary px-4">
          Back to notes
        </a>
        <a href="/discover" className="ui-btn ui-btn-text">
          Discover
        </a>
      </div>
    </main>
  );
}
