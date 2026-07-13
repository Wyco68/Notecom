package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// The HTTP surface deliberately mirrors vaultd's contract 1:1 (same paths,
// same bodies, same responses) so the Next.js client (lib/vault/helper.ts)
// switches source by changing a base URL, not its call sites. The difference
// is entirely behind the wire: stored reads/writes SQLite and enqueues a sync
// op per mutation, where vaultd touched the filesystem.

func (s *server) routes(mux *http.ServeMux) {
	mux.HandleFunc("/status", s.handleStatus)
	mux.HandleFunc("/tree", s.handleTree)
	mux.HandleFunc("/import", s.handleImport)
	mux.HandleFunc("/folder", s.handleFolder)
	mux.HandleFunc("/folder/", s.handleFolderPath)
	for _, kind := range []string{KindLesson, KindQuiz, KindAssignment} {
		mux.HandleFunc("/"+kind, s.handleSave(kind))
		mux.HandleFunc("/"+kind+"/", s.handleDocPath(kind))
	}
}

func decode(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}

// --- tree ---

type treeEntry struct {
	ID    string `json:"id"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Seq   int    `json:"seq"`
}

type treeFolder struct {
	Name        string      `json:"name"`
	Lessons     []treeEntry `json:"lessons"`
	Quizzes     []treeEntry `json:"quizzes"`
	Assignments []treeEntry `json:"assignments"`
}

func (s *server) handleTree(w http.ResponseWriter, r *http.Request) {
	folders, err := s.folders.ListActive()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	docs, err := s.docs.ListActiveTree()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Two queries total regardless of folder count; group in memory.
	out := make([]treeFolder, 0, len(folders))
	bySlug := make(map[string]*treeFolder, len(folders))
	for _, f := range folders {
		out = append(out, treeFolder{Name: f.Slug, Lessons: []treeEntry{}, Quizzes: []treeEntry{}, Assignments: []treeEntry{}})
		bySlug[f.Slug] = &out[len(out)-1]
	}
	for _, d := range docs {
		tf := bySlug[d.FolderSlug]
		if tf == nil {
			continue
		}
		e := treeEntry{ID: d.DocKey, Slug: d.Slug, Title: d.Title, Seq: d.Seq}
		switch d.Kind {
		case KindLesson:
			tf.Lessons = append(tf.Lessons, e)
		case KindQuiz:
			tf.Quizzes = append(tf.Quizzes, e)
		case KindAssignment:
			tf.Assignments = append(tf.Assignments, e)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"folders": out})
}

// --- folders ---

func (s *server) handleFolder(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := decode(r, &body); err != nil || !safeName(body.Name) {
		writeErr(w, http.StatusBadRequest, "invalid folder name")
		return
	}
	// The app pre-slugifies; the folder's slug and display name are the same
	// value here, exactly as vaultd stored it as a directory name.
	s.mu.Lock()
	_, err := s.folders.Create(body.Name, body.Name, true)
	s.mu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	mirrorFolderCreate(body.Name)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) handleFolderPath(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/folder/")
	if r.Method != http.MethodDelete || !safeName(name) {
		writeErr(w, http.StatusBadRequest, "invalid request")
		return
	}
	s.mu.Lock()
	err := s.folders.Delete(name, true)
	s.mu.Unlock()
	if err != nil {
		s.writeRepoErr(w, err)
		return
	}
	mirrorFolderDelete(name)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- documents (lesson/quiz/assignment share this, keyed by kind) ---

// handleSave is POST /{kind}: create or update a fully-resolved document.
// The folder is ensured (idempotent) so an ingest right after generation
// doesn't require a separate folder call.
func (s *server) handleSave(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
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
		if err := decode(r, &body); err != nil {
			writeErr(w, http.StatusBadRequest, "invalid body")
			return
		}
		if !safeName(body.Folder) || !safeName(body.ID) {
			writeErr(w, http.StatusBadRequest, "invalid folder or id")
			return
		}
		in := SaveInput{
			FolderSlug: body.Folder, Kind: kind, DocKey: body.ID,
			Slug: body.Slug, Title: body.Title, Seq: body.Seq, HTML: body.HTML,
		}
		s.mu.Lock()
		_, err := s.folders.Create(body.Folder, body.Folder, true)
		if err == nil {
			_, err = s.docs.Save(in, true)
		}
		s.mu.Unlock()
		if err != nil {
			s.writeRepoErr(w, err)
			return
		}
		mirrorFolderCreate(body.Folder)
		mirrorDocSave(kind, in)
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// handleDocPath serves /{kind}/{folder}/{id} (GET load, DELETE) and
// /{kind}/{folder}/{id}/rename (POST).
func (s *server) handleDocPath(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/"+kind+"/")
		parts := strings.Split(rest, "/")
		if len(parts) < 2 || !safeName(parts[0]) || !safeName(parts[1]) {
			writeErr(w, http.StatusBadRequest, "invalid path")
			return
		}
		folder, id := parts[0], parts[1]

		if len(parts) == 3 && parts[2] == "rename" {
			if r.Method != http.MethodPost {
				writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			var body struct {
				NewTitle string `json:"newTitle"`
			}
			if err := decode(r, &body); err != nil || body.NewTitle == "" {
				writeErr(w, http.StatusBadRequest, "newTitle required")
				return
			}
			s.mu.Lock()
			err := s.docs.Rename(folder, kind, id, body.NewTitle, true)
			s.mu.Unlock()
			if err != nil {
				s.writeRepoErr(w, err)
				return
			}
			mirrorDocRename(kind, folder, id, body.NewTitle)
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}

		switch r.Method {
		case http.MethodGet:
			doc, err := s.docs.GetByKey(folder, kind, id)
			if err != nil {
				s.writeRepoErr(w, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]string{"html": doc.HTML, "title": doc.Title})
		case http.MethodDelete:
			s.mu.Lock()
			err := s.docs.Delete(folder, kind, id, true)
			s.mu.Unlock()
			if err != nil {
				s.writeRepoErr(w, err)
				return
			}
			mirrorDocDelete(kind, folder, id)
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		default:
			writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}
}

// handleImport is the ingest path for Claude-authored content: scan the
// vault and upsert anything that differs (disk wins — see import.go). What
// it changes is enqueued for sync, so a lesson generated by /lect reaches
// the other devices like any in-app edit.
func (s *server) handleImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.mu.Lock()
	st, err := s.importVault(vaultRoot(), true)
	s.mu.Unlock()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stats": st})
}

func (s *server) writeRepoErr(w http.ResponseWriter, err error) {
	if errors.Is(err, errNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	writeErr(w, http.StatusInternalServerError, err.Error())
}
