// Shapes duplicated from the Next.js app — source of truth is
// lib/vault/helper.ts (LessonEntry/TreeFolder) and lib/vault/gcs.ts
// (SearchEntry/SearchResult). The Worker can't import Next code; keep in
// sync manually if index.json or the search index format ever changes.

export interface Env {
  CONTENT: KVNamespace;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  API_TOKEN: string;
  WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
}

export interface LessonEntry {
  id: string;
  slug: string;
  title: string;
  seq: number;
}

export interface TreeFolder {
  name: string;
  lessons: LessonEntry[];
  quizzes: LessonEntry[];
  assignments: LessonEntry[];
}

export interface SearchEntry {
  folder: string;
  id: string;
  kind: "lesson" | "quiz" | "assignment";
  seq: number;
  title: string;
  heading: string;
  headingIndex: number;
  text: string;
}

export interface SearchResult {
  folder: string;
  id: string;
  kind: "lesson" | "quiz" | "assignment";
  title: string;
  topic: string;
  heading: string;
  summary: string;
  keywords: string;
  seq: number;
  headingIndex: number;
  score: number;
}

export interface Manifest {
  commitSha: string;
  syncedAt: number;
  files: Record<string, string>; // repo path -> blob sha
}
