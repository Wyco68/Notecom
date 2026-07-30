export interface Lesson {
  id: string; // flat file stem, e.g. "01-intro"
  slug: string;
  title: string;
  seq: number;
}

// Same shape as Lesson — kept as a distinct alias since quizzes are a
// separate index.json array and a separate document kind.
export type Quiz = Lesson;

export interface Folder {
  name: string;
  lessons: Lesson[];
  quizzes: Quiz[];
}

export interface VaultTree {
  folders: Folder[];
  // Runtime flag from /api/tree: hides write controls on a READ_ONLY=1 box.
  readOnly?: boolean;
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
