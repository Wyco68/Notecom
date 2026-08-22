export interface Lesson {
  id: string; // flat file stem, e.g. "01-intro"
  slug: string;
  title: string;
  seq: number;
}

// Same shape as Lesson — kept as a distinct alias since quizzes are a
// separate index.json array and a separate document kind.
export type Quiz = Lesson;

// A folder in the tree is its identity (slug) and its label (name) — nothing
// else. Its documents are fetched separately, when the reader opens it — a
// vault with many folders would otherwise pay for every lesson row in the
// account on first paint, to show a list of collapsed folders. See FolderDocs.
export interface Folder {
  name: string; // slug — identity, used in URLs and as the doc-fetch key
  displayName: string; // human label shown in the UI; renameable independently of `name`
}

/** One folder's contents, from `GET /api/folders/[name]`. */
export interface FolderDocs {
  lessons: Lesson[];
  quizzes: Quiz[];
}

export interface VaultTree {
  folders: Folder[];
}

// A selected lesson or quiz is identified by its folder + id + kind.
// heading/headingIndex are set when the selection came from a search hit:
// the viewer scrolls to the headingIndex-th occurrence of that heading
// (headings like "How it Works" repeat within a lesson).
export interface LessonRef {
  folder: string;
  id: string;
  kind: "lesson" | "quiz";
  heading?: string;
  headingIndex?: number;
}
