// Command indexd is the search/retrieval service for Notes (RAG backend).
//
// It is the *only* place with indexing intelligence: it chunks lesson HTML
// into educational sections, generates embeddings (via a local Ollama
// server when available), and answers hybrid search queries (FTS5 keyword
// + vector cosine, merged with reciprocal-rank fusion). vaultd stays a dumb
// filesystem helper and the Next.js app never generates embeddings — it
// only proxies queries here (see docs/architecture.md).
//
// All index state lives in one SQLite file, <vault>/.index/index.db —
// derived data, safe to delete (a reindex rebuilds it from the HTML).
// Embeddings are stored as float32 BLOBs and compared brute-force; at
// personal-vault scale (hundreds of chunks) this outperforms running a
// separate vector-database server and needs zero extra processes.
//
// Degradation is deliberate: without Ollama, indexing still runs and
// search still works in keyword (FTS5) mode; embeddings backfill on the
// next scan after Ollama appears.
//
// Endpoints:
//
//	POST   /index                        index/update one document {folder,id,kind}
//	DELETE /index/{folder}/{id}?kind=    remove one document from the index
//	POST   /reindex                      async full vault scan (202)
//	GET    /search?q&folder&kind&limit&html=1
//	GET    /related/{folder}/{id}?kind&limit
//	GET    /topics?q&limit
//	POST   /chat                         grounded chat over the vault (SSE)
//	GET    /status
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type server struct {
	db     *database
	embed  *embedder
	scanMu sync.Mutex // one scan at a time
	// lastScan/scanning are read by /status only; guarded by scanMu.
	lastScan time.Time
	scanning bool
}

func main() {
	addr := os.Getenv("INDEXD_ADDR")
	if addr == "" {
		addr = "127.0.0.1:4322"
	}

	dbPath := filepath.Join(vaultRoot(), ".index", "index.db")
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		log.Fatal(err)
	}
	db, err := openDatabase(dbPath)
	if err != nil {
		log.Fatal(err)
	}

	s := &server{db: db, embed: newEmbedder()}

	mux := http.NewServeMux()
	mux.HandleFunc("/index", s.handleIndex)
	mux.HandleFunc("/index/", s.handleIndexPath)
	mux.HandleFunc("/reindex", s.handleReindex)
	mux.HandleFunc("/search", s.handleSearch)
	mux.HandleFunc("/related/", s.handleRelated)
	mux.HandleFunc("/topics", s.handleTopics)
	mux.HandleFunc("/chat", s.handleChat)
	mux.HandleFunc("/status", s.handleStatus)

	// Startup scan so a fresh DB (or lessons written while indexd was down)
	// become searchable without anyone having to call /reindex.
	go s.scan()

	log.Printf("indexd listening on %s (root=%s, db=%s)", addr, vaultRoot(), dbPath)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func vaultRoot() string {
	if r := os.Getenv("VAULT_ROOT"); r != "" {
		return r
	}
	return "vault"
}

// safeName mirrors vaultd's path-segment guard: reject anything that could
// escape the vault or hit a dot-entry.
func safeName(name string) (string, bool) {
	if name == "" || strings.HasPrefix(name, ".") ||
		strings.ContainsAny(name, `/\`) || strings.Contains(name, "..") {
		return "", false
	}
	return name, true
}

func validKind(kind string) bool {
	return kind == "lesson" || kind == "quiz" || kind == "assignment"
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// --- POST /index ---

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	var body struct {
		Folder string `json:"folder"`
		ID     string `json:"id"`
		Kind   string `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	folder, ok1 := safeName(body.Folder)
	id, ok2 := safeName(body.ID)
	if !ok1 || !ok2 || !validKind(body.Kind) {
		writeErr(w, http.StatusBadRequest, "invalid folder, id, or kind")
		return
	}
	if err := s.indexOne(folder, id, body.Kind); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- DELETE /index/{folder}/{id}?kind= ---

func (s *server) handleIndexPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeErr(w, http.StatusMethodNotAllowed, "use DELETE")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/index/"), "/")
	if len(parts) != 2 {
		writeErr(w, http.StatusBadRequest, "expected /index/{folder}/{id}")
		return
	}
	folder, ok1 := safeName(parts[0])
	id, ok2 := safeName(parts[1])
	kind := r.URL.Query().Get("kind")
	if kind == "" {
		kind = "lesson"
	}
	if !ok1 || !ok2 || !validKind(kind) {
		writeErr(w, http.StatusBadRequest, "invalid folder, id, or kind")
		return
	}
	if err := s.db.deleteDocument(folder, id, kind); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- POST /reindex ---

func (s *server) handleReindex(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	go s.scan()
	writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
}

// --- GET /status ---

func (s *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "use GET")
		return
	}
	docs, chunks, embedded, err := s.db.stats()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.scanMu.Lock()
	scanning, lastScan := s.scanning, s.lastScan
	s.scanMu.Unlock()
	last := ""
	if !lastScan.IsZero() {
		last = lastScan.UTC().Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"documents": docs,
		"chunks":    chunks,
		"embedded":  embedded,
		"ollama":    s.embed.available(),
		"model":     s.embed.model,
		"scanning":  scanning,
		"lastScan":  last,
	})
}
