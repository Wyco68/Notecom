// Naming stays in the app: the database receives the result, never the raw
// name. Case is preserved, not folded — the sidebar tree (components/sidebar/
// FileTree.tsx) shows this slug directly as the folder's name, with no
// separate display column, so lowercasing it here silently discarded whatever
// case the person typed. Claude Code's own vault folders are already
// case-preserving kebab-case ("Wireless-Network", not "wireless-network");
// this matches that instead of fighting it.
export function slugify(input: string): string {
  const slug = input
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}
