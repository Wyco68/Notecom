package main

import (
	"database/sql"
	"encoding/binary"
	"fmt"
	"math"
	"strings"

	_ "modernc.org/sqlite"
)

type database struct {
	sql *sql.DB
}

// documents = one row per indexed lesson/quiz/assignment file.
// chunks = one row per educational section of a document.
// chunks_fts = standalone FTS5 table sharing rowids with chunks (kept in
// sync manually — chunks only ever change by whole-document replace, so
// external-content triggers would be complexity for nothing).
const schema = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS documents (
  doc_id     INTEGER PRIMARY KEY,
  folder     TEXT NOT NULL,
  id         TEXT NOT NULL,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  hash       TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(folder, id, kind)
);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id  INTEGER PRIMARY KEY,
  doc_id    INTEGER NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  topic     TEXT NOT NULL,
  heading   TEXT NOT NULL,
  summary   TEXT NOT NULL,
  keywords  TEXT NOT NULL,
  text      TEXT NOT NULL,
  html      TEXT NOT NULL,
  embedding BLOB
);

CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  heading, topic, keywords, text
);
`

func openDatabase(path string) (*database, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}
	// modernc/sqlite allows one writer; a single connection avoids
	// SQLITE_BUSY races between the scanner and API handlers entirely.
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &database{sql: db}, nil
}

// --- embedding blob encoding (float32 little-endian, L2-normalized) ---

func encodeVec(v []float32) []byte {
	buf := make([]byte, 4*len(v))
	for i, f := range v {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	return buf
}

func decodeVec(b []byte) []float32 {
	v := make([]float32, len(b)/4)
	for i := range v {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return v
}

func normalize(v []float32) []float32 {
	var sum float64
	for _, f := range v {
		sum += float64(f) * float64(f)
	}
	n := math.Sqrt(sum)
	if n == 0 {
		return v
	}
	out := make([]float32, len(v))
	for i, f := range v {
		out[i] = float32(float64(f) / n)
	}
	return out
}

// dot of two normalized vectors = cosine similarity.
func dot(a, b []float32) float64 {
	if len(a) != len(b) {
		return 0
	}
	var sum float64
	for i := range a {
		sum += float64(a[i]) * float64(b[i])
	}
	return sum
}

// --- document/chunk persistence ---

func (d *database) docHash(folder, id, kind string) (string, bool, error) {
	var h string
	err := d.sql.QueryRow(
		`SELECT hash FROM documents WHERE folder=? AND id=? AND kind=?`,
		folder, id, kind).Scan(&h)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	return h, err == nil, err
}

// replaceDocument atomically swaps a document's chunks (and FTS rows).
func (d *database) replaceDocument(folder, id, kind, title, hash string, chunks []chunk) error {
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var docID int64
	err = tx.QueryRow(`SELECT doc_id FROM documents WHERE folder=? AND id=? AND kind=?`,
		folder, id, kind).Scan(&docID)
	switch {
	case err == sql.ErrNoRows:
		res, err := tx.Exec(`INSERT INTO documents(folder, id, kind, title, hash) VALUES(?,?,?,?,?)`,
			folder, id, kind, title, hash)
		if err != nil {
			return err
		}
		docID, _ = res.LastInsertId()
	case err != nil:
		return err
	default:
		if _, err := tx.Exec(`UPDATE documents SET title=?, hash=?, indexed_at=datetime('now') WHERE doc_id=?`,
			title, hash, docID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM chunks_fts WHERE rowid IN (SELECT chunk_id FROM chunks WHERE doc_id=?)`, docID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM chunks WHERE doc_id=?`, docID); err != nil {
			return err
		}
	}

	for i, c := range chunks {
		var emb any
		if len(c.Embedding) > 0 {
			emb = encodeVec(normalize(c.Embedding))
		}
		res, err := tx.Exec(
			`INSERT INTO chunks(doc_id, seq, topic, heading, summary, keywords, text, html, embedding)
			 VALUES(?,?,?,?,?,?,?,?,?)`,
			docID, i+1, c.Topic, c.Heading, c.Summary, c.Keywords, c.Text, c.HTML, emb)
		if err != nil {
			return err
		}
		chunkID, _ := res.LastInsertId()
		if _, err := tx.Exec(
			`INSERT INTO chunks_fts(rowid, heading, topic, keywords, text) VALUES(?,?,?,?,?)`,
			chunkID, c.Heading, c.Topic, c.Keywords, c.Text); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *database) deleteDocument(folder, id, kind string) error {
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`DELETE FROM chunks_fts WHERE rowid IN (
		   SELECT chunk_id FROM chunks WHERE doc_id IN (
		     SELECT doc_id FROM documents WHERE folder=? AND id=? AND kind=?))`,
		folder, id, kind); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM documents WHERE folder=? AND id=? AND kind=?`,
		folder, id, kind); err != nil {
		return err
	}
	return tx.Commit()
}

type docKey struct {
	Folder, ID, Kind string
}

func (d *database) allDocuments() (map[docKey]string, error) {
	rows, err := d.sql.Query(`SELECT folder, id, kind, hash FROM documents`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[docKey]string{}
	for rows.Next() {
		var k docKey
		var h string
		if err := rows.Scan(&k.Folder, &k.ID, &k.Kind, &h); err != nil {
			return nil, err
		}
		out[k] = h
	}
	return out, rows.Err()
}

// docsMissingEmbeddings lists documents that have at least one chunk
// without a vector — the backfill set once Ollama becomes available.
func (d *database) docsMissingEmbeddings() ([]docKey, error) {
	rows, err := d.sql.Query(
		`SELECT DISTINCT dc.folder, dc.id, dc.kind
		   FROM documents dc JOIN chunks c ON c.doc_id = dc.doc_id
		  WHERE c.embedding IS NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []docKey
	for rows.Next() {
		var k docKey
		if err := rows.Scan(&k.Folder, &k.ID, &k.Kind); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (d *database) stats() (docs, chunks, embedded int, err error) {
	err = d.sql.QueryRow(`SELECT
		(SELECT COUNT(*) FROM documents),
		(SELECT COUNT(*) FROM chunks),
		(SELECT COUNT(*) FROM chunks WHERE embedding IS NOT NULL)`).
		Scan(&docs, &chunks, &embedded)
	return
}

// --- retrieval primitives ---

type hit struct {
	ChunkID int64
	Score   float64
}

// ftsQuery turns free text into a safe FTS5 MATCH expression: each word
// double-quoted (so FTS operators in user input can't break the query),
// OR-joined, ranked by bm25.
func ftsQuery(q string) string {
	fields := strings.FieldsFunc(q, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9')
	})
	var terms []string
	for _, f := range fields {
		terms = append(terms, `"`+f+`"`)
	}
	return strings.Join(terms, " OR ")
}

func (d *database) keywordSearch(q, folder, kind string, limit int) ([]hit, error) {
	match := ftsQuery(q)
	if match == "" {
		return nil, nil
	}
	rows, err := d.sql.Query(
		`SELECT f.rowid, bm25(chunks_fts) AS rank
		   FROM chunks_fts f
		   JOIN chunks c   ON c.chunk_id = f.rowid
		   JOIN documents dc ON dc.doc_id = c.doc_id
		  WHERE chunks_fts MATCH ?
		    AND (? = '' OR dc.folder = ?)
		    AND (? = '' OR dc.kind = ?)
		  ORDER BY rank LIMIT ?`,
		match, folder, folder, kind, kind, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []hit
	for rows.Next() {
		var h hit
		if err := rows.Scan(&h.ChunkID, &h.Score); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// vectorSearch brute-forces cosine over stored embeddings. qv must be
// normalized.
func (d *database) vectorSearch(qv []float32, folder, kind string, limit int) ([]hit, error) {
	rows, err := d.sql.Query(
		`SELECT c.chunk_id, c.embedding
		   FROM chunks c JOIN documents dc ON dc.doc_id = c.doc_id
		  WHERE c.embedding IS NOT NULL
		    AND (? = '' OR dc.folder = ?)
		    AND (? = '' OR dc.kind = ?)`,
		folder, folder, kind, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []hit
	for rows.Next() {
		var id int64
		var blob []byte
		if err := rows.Scan(&id, &blob); err != nil {
			return nil, err
		}
		out = append(out, hit{ChunkID: id, Score: dot(qv, decodeVec(blob))})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortHits(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func sortHits(hs []hit) {
	// insertion sort — candidate sets here are tiny.
	for i := 1; i < len(hs); i++ {
		for j := i; j > 0 && hs[j].Score > hs[j-1].Score; j-- {
			hs[j], hs[j-1] = hs[j-1], hs[j]
		}
	}
}

type chunkRow struct {
	Folder   string  `json:"folder"`
	ID       string  `json:"id"`
	Kind     string  `json:"kind"`
	Title    string  `json:"title"`
	Topic    string  `json:"topic"`
	Heading  string  `json:"heading"`
	Summary  string  `json:"summary"`
	Keywords string  `json:"keywords"`
	Seq      int     `json:"seq"`
	// HeadingIndex = 0-based occurrence of this heading text within the
	// document — headings like "How it Works" repeat per concept, so the
	// viewer needs "the Nth one" to scroll to the right section.
	HeadingIndex int     `json:"headingIndex"`
	Score        float64 `json:"score"`
	HTML         string  `json:"html,omitempty"`
}

func (d *database) loadChunkRows(ids []int64, withHTML bool) (map[int64]chunkRow, error) {
	if len(ids) == 0 {
		return map[int64]chunkRow{}, nil
	}
	ph := strings.Repeat("?,", len(ids))
	ph = ph[:len(ph)-1]
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	// heading occurrence index is computed over the document's *entire*
	// chunk sequence (inner query) before filtering to the requested ids —
	// partitioning only the hits would miscount repeated headings.
	rows, err := d.sql.Query(
		`SELECT chunk_id, folder, id, kind, title,
		        topic, heading, summary, keywords, seq, hidx, html
		   FROM (
		     SELECT c.chunk_id, dc.folder, dc.id, dc.kind, dc.title,
		            c.topic, c.heading, c.summary, c.keywords, c.seq, c.html,
		            ROW_NUMBER() OVER (PARTITION BY c.doc_id, c.heading ORDER BY c.seq) - 1 AS hidx
		       FROM chunks c JOIN documents dc ON dc.doc_id = c.doc_id
		   )
		  WHERE chunk_id IN (`+ph+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]chunkRow{}
	for rows.Next() {
		var id int64
		var r chunkRow
		var htmlCol string
		if err := rows.Scan(&id, &r.Folder, &r.ID, &r.Kind, &r.Title,
			&r.Topic, &r.Heading, &r.Summary, &r.Keywords, &r.Seq, &r.HeadingIndex, &htmlCol); err != nil {
			return nil, err
		}
		if withHTML {
			r.HTML = htmlCol
		}
		out[id] = r
	}
	return out, rows.Err()
}

// docCentroids returns each document's mean chunk vector (normalized),
// keyed by "folder|id|kind" — the basis for related-lesson scoring.
func (d *database) docCentroids() (map[docKey][]float32, map[docKey]string, error) {
	rows, err := d.sql.Query(
		`SELECT dc.folder, dc.id, dc.kind, dc.title, c.embedding
		   FROM chunks c JOIN documents dc ON dc.doc_id = c.doc_id
		  WHERE c.embedding IS NOT NULL`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	sums := map[docKey][]float64{}
	counts := map[docKey]int{}
	titles := map[docKey]string{}
	for rows.Next() {
		var k docKey
		var title string
		var blob []byte
		if err := rows.Scan(&k.Folder, &k.ID, &k.Kind, &title, &blob); err != nil {
			return nil, nil, err
		}
		v := decodeVec(blob)
		s := sums[k]
		if s == nil {
			s = make([]float64, len(v))
		}
		for i, f := range v {
			s[i] += float64(f)
		}
		sums[k] = s
		counts[k]++
		titles[k] = title
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	out := map[docKey][]float32{}
	for k, s := range sums {
		v := make([]float32, len(s))
		for i, f := range s {
			v[i] = float32(f / float64(counts[k]))
		}
		out[k] = normalize(v)
	}
	return out, titles, nil
}
