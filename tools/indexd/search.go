package main

import (
	"net/http"
	"strconv"
	"strings"
)

// --- GET /search?q=&folder=&kind=&limit=&html=1 ---
//
// FTS5 keyword retrieval over the chunk index. `mode` is always "keyword";
// it stays in the response because callers already read it.
func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "use GET")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeErr(w, http.StatusBadRequest, "missing q")
		return
	}
	folder := r.URL.Query().Get("folder")
	kind := r.URL.Query().Get("kind")
	if kind != "" && !validKind(kind) {
		writeErr(w, http.StatusBadRequest, "invalid kind")
		return
	}
	limit := queryInt(r, "limit", 10, 50)
	withHTML := r.URL.Query().Get("html") == "1"

	hits, err := s.db.keywordSearch(q, folder, kind, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	results, err := s.resolveHits(hits, withHTML)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mode": "keyword", "results": results})
}

func (s *server) resolveHits(hits []hit, withHTML bool) ([]chunkRow, error) {
	ids := make([]int64, len(hits))
	for i, h := range hits {
		ids[i] = h.ChunkID
	}
	rows, err := s.db.loadChunkRows(ids, withHTML)
	if err != nil {
		return nil, err
	}
	results := make([]chunkRow, 0, len(hits))
	for _, h := range hits {
		if r, ok := rows[h.ChunkID]; ok {
			r.Score = h.Score
			results = append(results, r)
		}
	}
	return results, nil
}

// --- GET /related/{folder}/{id}?kind=&limit= ---
//
// Related documents by an FTS query built from this document's own keywords:
// whatever else scores highly on the terms this document is made of.
func (s *server) handleRelated(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "use GET")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/related/"), "/")
	if len(parts) != 2 {
		writeErr(w, http.StatusBadRequest, "expected /related/{folder}/{id}")
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
	limit := queryInt(r, "limit", 5, 20)
	self := docKey{folder, id, kind}

	type related struct {
		Folder string  `json:"folder"`
		ID     string  `json:"id"`
		Kind   string  `json:"kind"`
		Title  string  `json:"title"`
		Score  float64 `json:"score"`
	}

	var out []related
	hits, err := s.keywordRelated(self, limit*4)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	rows, err := s.resolveHits(hits, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	seen := map[docKey]bool{self: true}
	for _, r := range rows {
		k := docKey{r.Folder, r.ID, r.Kind}
		if seen[k] {
			continue
		}
		seen[k] = true
		// raw bm25 is negative-is-better, so expose a rank-based score:
		// higher means more related.
		out = append(out, related{r.Folder, r.ID, r.Kind, r.Title, 1.0 / float64(len(out)+1)})
	}
	if len(out) > limit {
		out = out[:limit]
	}
	if out == nil {
		out = []related{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": out})
}

func (s *server) keywordRelated(self docKey, limit int) ([]hit, error) {
	var kw string
	err := s.db.sql.QueryRow(
		`SELECT group_concat(keywords, ' ') FROM chunks c
		   JOIN documents dc ON dc.doc_id = c.doc_id
		  WHERE dc.folder=? AND dc.id=? AND dc.kind=?`,
		self.Folder, self.ID, self.Kind).Scan(&kw)
	if err != nil || strings.TrimSpace(kw) == "" {
		return nil, err
	}
	return s.db.keywordSearch(kw, "", "", limit)
}

// --- GET /topics?q=&limit= ---
//
// Topic-level view of a search: hits grouped by (topic, document), best
// chunk score wins. Feeds "Related Topics" style features.
func (s *server) handleTopics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, http.StatusMethodNotAllowed, "use GET")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeErr(w, http.StatusBadRequest, "missing q")
		return
	}
	limit := queryInt(r, "limit", 10, 30)

	kw, err := s.db.keywordSearch(q, "", "", 50)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	rows, err := s.resolveHits(kw, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	type topicHit struct {
		Topic  string  `json:"topic"`
		Folder string  `json:"folder"`
		ID     string  `json:"id"`
		Kind   string  `json:"kind"`
		Title  string  `json:"title"`
		Score  float64 `json:"score"`
	}
	type topicKey struct {
		topic string
		doc   docKey
	}
	seen := map[topicKey]bool{}
	out := []topicHit{}
	for _, r := range rows {
		k := topicKey{r.Topic, docKey{r.Folder, r.ID, r.Kind}}
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, topicHit{r.Topic, r.Folder, r.ID, r.Kind, r.Title, r.Score})
		if len(out) == limit {
			break
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": out})
}

func queryInt(r *http.Request, name string, def, max int) int {
	v, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil || v < 1 {
		return def
	}
	if v > max {
		return max
	}
	return v
}
