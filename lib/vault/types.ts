export interface Lesson {
  id: string; // flat file stem, e.g. "01-intro"
  slug: string;
  title: string;
  seq: number;
}

// Same shape as Lesson — kept as a distinct alias since quizzes are a
// separate index.json array and separate vaultd namespace.
export type Quiz = Lesson;

export interface Folder {
  name: string;
  lessons: Lesson[];
  quizzes: Quiz[];
}

export interface VaultTree {
  folders: Folder[];
}

// A selected lesson or quiz is identified by its folder + id + kind.
export interface LessonRef {
  folder: string;
  id: string;
  kind: "lesson" | "quiz";
}
