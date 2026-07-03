// Command vaultd is a tiny filesystem helper for Notes.
//
// It is deliberately dumb: it performs raw filesystem I/O on a vault directory
// and contains ZERO business logic. It never decides folder names, filenames,
// slugs, sequence numbers, or lesson/quiz structure — every such value is
// supplied, fully resolved, by the caller (Next.js or Claude Code).
//
// Storage layout it maintains:
//
//	<root>/<Folder>/index.json        { "lessons": [...], "quizzes": [...] }
//	<root>/<Folder>/<id>.html         one lesson's generated HTML, written as-is
//	<root>/<Folder>/quiz-<id>.html    one quiz's generated HTML, written as-is
//
// The quiz- filename prefix keeps quiz files from colliding with lesson
// files in the same folder, since lessons and quizzes number their <id>
// sequences independently.
//
// index.json used to be a bare array (lessons only). loadIndexData reads
// both the old array shape and the new {lessons,quizzes} object shape;
// every write goes out in the new shape, so folders migrate the first time
// anything in them is saved.
//
// Operations, one HTTP endpoint each:
//
//	POST   /folder                       CreateFolder
//	DELETE /folder/{name}                DeleteFolder
//	POST   /lesson                       SaveLesson
//	GET    /lesson/{folder}/{id}         LoadLesson
//	DELETE /lesson/{folder}/{id}         DeleteLesson
//	POST   /lesson/{folder}/{id}/rename  RenameLesson
//	POST   /quiz                         SaveQuiz
//	GET    /quiz/{folder}/{id}           LoadQuiz
//	DELETE /quiz/{folder}/{id}           DeleteQuiz
//	POST   /quiz/{folder}/{id}/rename    RenameQuiz
//	GET    /tree                         ListTree
package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// lessonEntry is one row of a folder's index.json (lessons or quizzes — same
// shape). All fields are decided by the caller; vaultd only stores and
// echoes them back.
type lessonEntry struct {
	ID    string `json:"id"`    // filename stem, e.g. "01-intro"
	Slug  string `json:"slug"`  // "intro"
	Title string `json:"title"` // human-readable
	Seq   int    `json:"seq"`   // ordering number
}

type quizEntry = lessonEntry

// indexData is the on-disk shape of index.json.
type indexData struct {
	Lessons []lessonEntry `json:"lessons"`
	Quizzes []quizEntry   `json:"quizzes"`
}

func main() {
	addr := os.Getenv("VAULTD_ADDR")
	if addr == "" {
		addr = "127.0.0.1:4321"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/folder", handleFolder)
	mux.HandleFunc("/folder/", handleFolderPath) // DELETE /folder/{name}
	mux.HandleFunc("/lesson", handleLessonRoot)  // POST /lesson (save)
	mux.HandleFunc("/lesson/", handleLessonPath) // /lesson/{folder}/{id}[/rename]
	mux.HandleFunc("/quiz", handleQuizRoot)      // POST /quiz (save)
	mux.HandleFunc("/quiz/", handleQuizPath)     // /quiz/{folder}/{id}[/rename]
	mux.HandleFunc("/tree", handleTree)

	log.Printf("vaultd listening on %s (root=%s)", addr, vaultRoot())
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

// vaultRoot resolves the vault directory from VAULT_ROOT, defaulting to ./vault
// relative to the process working directory.
func vaultRoot() string {
	if r := os.Getenv("VAULT_ROOT"); r != "" {
		return r
	}
	return "vault"
}

// safeName rejects any path segment that could escape the vault or resolve to
// a special entry. It rejects "", a leading "." (which covers "." — resolving
// to the vault root, so DELETE /folder/. would os.RemoveAll the whole vault —
// as well as ".." and hidden dotfiles), "/" or "\", and any embedded "..".
// Every real folder/id reaching vaultd is a slug and never starts with a dot.
// Security guard, not business logic — vaultd still doesn't *invent* names.
func safeName(name string) (string, bool) {
	if name == "" || strings.HasPrefix(name, ".") ||
		strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		return "", false
	}
	return name, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// --- index.json helpers ---

func indexPath(folder string) string {
	return filepath.Join(vaultRoot(), folder, "index.json")
}

// loadIndexData reads a folder's index.json, transparently upgrading the
// legacy bare-array (lessons-only) shape to {lessons, quizzes}.
func loadIndexData(folder string) (indexData, error) {
	data, err := os.ReadFile(indexPath(folder))
	if errors.Is(err, os.ErrNotExist) {
		return indexData{Lessons: []lessonEntry{}, Quizzes: []quizEntry{}}, nil
	}
	if err != nil {
		return indexData{}, err
	}
	var idx indexData
	if err := json.Unmarshal(data, &idx); err == nil {
		if idx.Lessons == nil {
			idx.Lessons = []lessonEntry{}
		}
		if idx.Quizzes == nil {
			idx.Quizzes = []quizEntry{}
		}
		return idx, nil
	}
	// Legacy format: index.json was a bare array of lessons.
	var legacy []lessonEntry
	if err := json.Unmarshal(data, &legacy); err != nil {
		return indexData{}, err
	}
	return indexData{Lessons: legacy, Quizzes: []quizEntry{}}, nil
}

func saveIndexData(folder string, idx indexData) error {
	if idx.Lessons == nil {
		idx.Lessons = []lessonEntry{}
	}
	if idx.Quizzes == nil {
		idx.Quizzes = []quizEntry{}
	}
	sort.Slice(idx.Lessons, func(i, j int) bool { return idx.Lessons[i].Seq < idx.Lessons[j].Seq })
	sort.Slice(idx.Quizzes, func(i, j int) bool { return idx.Quizzes[i].Seq < idx.Quizzes[j].Seq })
	data, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(indexPath(folder), data, 0o644)
}

func upsertEntry(entries []lessonEntry, entry lessonEntry) []lessonEntry {
	for i := range entries {
		if entries[i].ID == entry.ID {
			entries[i] = entry
			return entries
		}
	}
	return append(entries, entry)
}

func removeEntry(entries []lessonEntry, id string) []lessonEntry {
	kept := entries[:0]
	for _, e := range entries {
		if e.ID != id {
			kept = append(kept, e)
		}
	}
	return kept
}

// --- POST /folder ---

func handleFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	name, ok := safeName(body.Name)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid folder name")
		return
	}
	dir := filepath.Join(vaultRoot(), name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Seed an empty index if the folder is new.
	if _, err := os.Stat(indexPath(name)); errors.Is(err, os.ErrNotExist) {
		if err := saveIndexData(name, indexData{Lessons: []lessonEntry{}, Quizzes: []quizEntry{}}); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- DELETE /folder/{name} ---

func handleFolderPath(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/folder/")
	folder, ok := safeName(name)
	if !ok {
		writeErr(w, http.StatusBadRequest, "invalid folder name")
		return
	}
	if r.Method != http.MethodDelete {
		writeErr(w, http.StatusMethodNotAllowed, "use DELETE")
		return
	}
	if err := os.RemoveAll(filepath.Join(vaultRoot(), folder)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- POST /lesson (SaveLesson) ---

func handleLessonRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	var body struct {
		Folder string `json:"folder"`
		ID     string `json:"id"`
		Slug   string `json:"slug"`
		Title  string `json:"title"`
		Seq    int    `json:"seq"`
		HTML   string `json:"html"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	folder, ok1 := safeName(body.Folder)
	id, ok2 := safeName(body.ID)
	if !ok1 || !ok2 {
		writeErr(w, http.StatusBadRequest, "invalid folder or id")
		return
	}
	dir := filepath.Join(vaultRoot(), folder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := os.WriteFile(filepath.Join(dir, id+".html"), []byte(body.HTML), 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx, err := loadIndexData(folder)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx.Lessons = upsertEntry(idx.Lessons, lessonEntry{ID: id, Slug: body.Slug, Title: body.Title, Seq: body.Seq})
	if err := saveIndexData(folder, idx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- /lesson/{folder}/{id}[/rename] ---

func handleLessonPath(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/lesson/")
	parts := strings.Split(rest, "/")
	if len(parts) < 2 {
		writeErr(w, http.StatusBadRequest, "expected /lesson/{folder}/{id}")
		return
	}
	folder, ok1 := safeName(parts[0])
	id, ok2 := safeName(parts[1])
	if !ok1 || !ok2 {
		writeErr(w, http.StatusBadRequest, "invalid folder or id")
		return
	}

	if len(parts) == 3 && parts[2] == "rename" {
		renameEntry(w, r, folder, id, "lesson")
		return
	}

	switch r.Method {
	case http.MethodGet:
		loadContent(w, folder, id, "lesson")
	case http.MethodDelete:
		deleteContent(w, folder, id, "lesson")
	default:
		writeErr(w, http.StatusMethodNotAllowed, "use GET or DELETE")
	}
}

// --- POST /quiz (SaveQuiz) ---

func handleQuizRoot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	var body struct {
		Folder string `json:"folder"`
		ID     string `json:"id"`
		Slug   string `json:"slug"`
		Title  string `json:"title"`
		Seq    int    `json:"seq"`
		HTML   string `json:"html"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	folder, ok1 := safeName(body.Folder)
	id, ok2 := safeName(body.ID)
	if !ok1 || !ok2 {
		writeErr(w, http.StatusBadRequest, "invalid folder or id")
		return
	}
	dir := filepath.Join(vaultRoot(), folder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := os.WriteFile(filepath.Join(dir, "quiz-"+id+".html"), []byte(body.HTML), 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx, err := loadIndexData(folder)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx.Quizzes = upsertEntry(idx.Quizzes, quizEntry{ID: id, Slug: body.Slug, Title: body.Title, Seq: body.Seq})
	if err := saveIndexData(folder, idx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- /quiz/{folder}/{id}[/rename] ---

func handleQuizPath(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/quiz/")
	parts := strings.Split(rest, "/")
	if len(parts) < 2 {
		writeErr(w, http.StatusBadRequest, "expected /quiz/{folder}/{id}")
		return
	}
	folder, ok1 := safeName(parts[0])
	id, ok2 := safeName(parts[1])
	if !ok1 || !ok2 {
		writeErr(w, http.StatusBadRequest, "invalid folder or id")
		return
	}

	if len(parts) == 3 && parts[2] == "rename" {
		renameEntry(w, r, folder, id, "quiz")
		return
	}

	switch r.Method {
	case http.MethodGet:
		loadContent(w, folder, id, "quiz")
	case http.MethodDelete:
		deleteContent(w, folder, id, "quiz")
	default:
		writeErr(w, http.StatusMethodNotAllowed, "use GET or DELETE")
	}
}

// --- shared lesson/quiz operations ---
// kind is "lesson" or "quiz"; it picks the on-disk filename prefix and
// which index.json array to read/write.

func contentFilename(id, kind string) string {
	if kind == "quiz" {
		return "quiz-" + id + ".html"
	}
	return id + ".html"
}

func loadContent(w http.ResponseWriter, folder, id, kind string) {
	data, err := os.ReadFile(filepath.Join(vaultRoot(), folder, contentFilename(id, kind)))
	if errors.Is(err, os.ErrNotExist) {
		writeErr(w, http.StatusNotFound, kind+" not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	title := id
	if idx, err := loadIndexData(folder); err == nil {
		entries := idx.Lessons
		if kind == "quiz" {
			entries = idx.Quizzes
		}
		for _, e := range entries {
			if e.ID == id {
				title = e.Title
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"html": string(data), "title": title})
}

func deleteContent(w http.ResponseWriter, folder, id, kind string) {
	if err := os.Remove(filepath.Join(vaultRoot(), folder, contentFilename(id, kind))); err != nil && !errors.Is(err, os.ErrNotExist) {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	idx, err := loadIndexData(folder)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if kind == "quiz" {
		idx.Quizzes = removeEntry(idx.Quizzes, id)
	} else {
		idx.Lessons = removeEntry(idx.Lessons, id)
	}
	if err := saveIndexData(folder, idx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func renameEntry(w http.ResponseWriter, r *http.Request, folder, id, kind string) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	var body struct {
		NewTitle string `json:"newTitle"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	idx, err := loadIndexData(folder)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	entries := idx.Lessons
	if kind == "quiz" {
		entries = idx.Quizzes
	}
	found := false
	for i := range entries {
		if entries[i].ID == id {
			entries[i].Title = body.NewTitle
			found = true
			break
		}
	}
	if !found {
		writeErr(w, http.StatusNotFound, kind+" not found")
		return
	}
	if kind == "quiz" {
		idx.Quizzes = entries
	} else {
		idx.Lessons = entries
	}
	if err := saveIndexData(folder, idx); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- GET /tree ---

type treeFolder struct {
	Name    string        `json:"name"`
	Lessons []lessonEntry `json:"lessons"`
	Quizzes []quizEntry   `json:"quizzes"`
}

func handleTree(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "use GET")
		return
	}
	root := vaultRoot()
	dirEntries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusOK, map[string][]treeFolder{"folders": {}})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	folders := []treeFolder{}
	for _, de := range dirEntries {
		if !de.IsDir() || strings.HasPrefix(de.Name(), ".") {
			continue
		}
		idx, err := loadIndexData(de.Name())
		if err != nil {
			// A folder on disk is real even if its index.json is unreadable at
			// this instant (e.g. a concurrent writer mid-save). Show it empty
			// rather than making the whole folder vanish from the sidebar.
			idx = indexData{Lessons: []lessonEntry{}, Quizzes: []quizEntry{}}
		}
		sort.Slice(idx.Lessons, func(i, j int) bool { return idx.Lessons[i].Seq < idx.Lessons[j].Seq })
		sort.Slice(idx.Quizzes, func(i, j int) bool { return idx.Quizzes[i].Seq < idx.Quizzes[j].Seq })
		folders = append(folders, treeFolder{Name: de.Name(), Lessons: idx.Lessons, Quizzes: idx.Quizzes})
	}
	sort.Slice(folders, func(i, j int) bool { return folders[i].Name < folders[j].Name })
	writeJSON(w, http.StatusOK, map[string][]treeFolder{"folders": folders})
}
