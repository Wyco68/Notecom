package main

import (
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

const rrfK = 60 // standard reciprocal-rank-fusion constant

// vectorFloor drops semantic "matches" that are only the least-dissimilar
// vectors in the corpus, not an actual match — cosine similarity is a
// continuous space, so a brute-force top-k always returns *something*,
// even for a query about nothing in the vault. Below this, a hit is noise.
const vectorFloor = 0.55

func filterFloor(hits []hit, floor float64) []hit {
	out := hits[:0]
	for _, h := range hits {
		if h.Score >= floor {
			out = append(out, h)
		}
	}
	return out
}

// --- GET /search?q=&folder=&kind=&limit=&html=1 ---
//
// Hybrid retrieval: FTS5 keyword ranks and vector cosine ranks are merged
// with reciprocal-rank fusion — RRF needs no score calibration between the
// two systems, which is exactly the problem with mixing bm25 and cosine
// directly. Without Ollama the vector leg is skipped and results are
// keyword-only (mode: "keyword").
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

	const candidates = 50
	kw, err := s.db.keywordSearch(q, folder, kind, candidates)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	mode := "keyword"
	var vec []hit
	if s.embed.available() {
		if qv, err := s.embed.embedQuery(q); err == nil {
			if vec, err = s.db.vectorSearch(qv, folder, kind, candidates); err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			vec = filterFloor(vec, vectorFloor)
			mode = "hybrid"
		} else {
			log.Printf("search: embed query failed, keyword-only: %v", err)
		}
	}

	fused := rrfMerge(kw, vec)
	if len(fused) > limit {
		fused = fused[:limit]
	}

	results, err := s.resolveHits(fused, withHTML)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mode": mode, "results": results})
}

// rrfMerge fuses ranked lists; input order inside each list = rank.
func rrfMerge(lists ...[]hit) []hit {
	scores := map[int64]float64{}
	for _, list := range lists {
		for rank, h := range list {
			scores[h.ChunkID] += 1.0 / float64(rrfK+rank+1)
		}
	}
	out := make([]hit, 0, len(scores))
	for id, sc := range scores {
		out = append(out, hit{ChunkID: id, Score: sc})
	}
	sortHits(out)
	return out
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
// Related documents by centroid cosine: mean of a document's chunk vectors
// vs every other document's. Falls back to an FTS query built from the
// document's keywords when vectors are missing.
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

	centroids, titles, err := s.db.docCentroids()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	var out []related
	if base, ok := centroids[self]; ok {
		for k, v := range centroids {
			if k == self {
				continue
			}
			out = append(out, related{k.Folder, k.ID, k.Kind, titles[k], dot(base, v)})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	} else {
		// no vectors — keyword fallback over this document's own terms
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
			// raw bm25 is negative-is-better; expose a rank-based score so
			// both branches of this endpoint mean "higher is more related".
			out = append(out, related{r.Folder, r.ID, r.Kind, r.Title, 1.0 / float64(len(out)+1)})
		}
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
// Topic-level view of a search: hybrid hits grouped by (topic, document),
// best chunk score wins. Feeds "Related Topics" style features.
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
	var vec []hit
	if s.embed.available() {
		if qv, err := s.embed.embedQuery(q); err == nil {
			vec, _ = s.db.vectorSearch(qv, "", "", 50)
		}
	}
	rows, err := s.resolveHits(rrfMerge(kw, vec), false)
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
