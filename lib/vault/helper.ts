// Kind-specific façade over the data layer.
//
// The route handlers speak in lessons and quizzes; lib/vault/store.ts speaks in
// documents with a `kind`. This file is only that translation — no queries, no
// permission logic, no HTTP. It was the client for the `stored` sidecar until
// the app started writing to Supabase directly; the exported names stayed put
// so the routes did not have to move with it.

import {
  createFolder,
  deleteDoc,
  deleteFolder,
  listFolderDocs,
  listFolders,
  loadDoc,
  renameDoc,
} from "./store";

export type { LessonEntry } from "./store";
export { createFolder, deleteFolder, listFolderDocs, listFolders };

export const loadLesson = (folder: string, id: string) => loadDoc(folder, id, "lesson");
export const deleteLesson = (folder: string, id: string) => deleteDoc(folder, id, "lesson");
export const renameLesson = (folder: string, id: string, newTitle: string) =>
  renameDoc(folder, id, "lesson", newTitle);

export const loadQuiz = (folder: string, id: string) => loadDoc(folder, id, "quiz");
export const deleteQuiz = (folder: string, id: string) => deleteDoc(folder, id, "quiz");
export const renameQuiz = (folder: string, id: string, newTitle: string) =>
  renameDoc(folder, id, "quiz", newTitle);
