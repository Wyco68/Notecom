package main

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

type database struct {
	sql *sql.DB
}

// documents = one row per indexed lesson/quiz file.
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
  html      TEXT NOT NULL
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
		res, err := tx.Exec(
			`INSERT INTO chunks(doc_id, seq, topic, heading, summary, keywords, text, html)
			 VALUES(?,?,?,?,?,?,?,?)`,
			docID, i+1, c.Topic, c.Heading, c.Summary, c.Keywords, c.Text, c.HTML)
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

func (d *database) stats() (docs, chunks int, err error) {
	err = d.sql.QueryRow(`SELECT
		(SELECT COUNT(*) FROM documents),
		(SELECT COUNT(*) FROM chunks)`).
		Scan(&docs, &chunks)
	return
}

// --- retrieval primitives ---

type hit struct {
	ChunkID int64
	Score   float64
}

// ftsQuery turns free text into a safe FTS5 MATCH expression: each word
// double-quoted (so FTS operators in user input can't break the query),
// AND-joined (FTS5's default for space-separated barewords) — every word
// must appear in the chunk. This is deliberately strict: an OR match lets
// a single shared filler word ("how", "to") pull in dozens of unrelated
// chunks once the query has more than a couple of words, since the
// candidate cap is reached by sheer volume rather than relevance.
func ftsQuery(q string) string {
	fields := strings.FieldsFunc(q, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9')
	})
	var terms []string
	for _, f := range fields {
		terms = append(terms, `"`+f+`"`)
	}
	return strings.Join(terms, " ")
}

func (d *database) keywordSearch(q, folder, kind string, limit int) ([]hit, error) {
	return d.keywordSearchDoc(q, folder, kind, "", limit)
}

// keywordSearchDoc additionally narrows to one document id when docID is
// non-empty — used by chat's current-document-first retrieval.
func (d *database) keywordSearchDoc(q, folder, kind, docID string, limit int) ([]hit, error) {
	return d.ftsMatch(ftsQuery(q), folder, kind, docID, limit)
}

func (d *database) ftsMatch(match, folder, kind, docID string, limit int) ([]hit, error) {
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
		    AND (? = '' OR dc.id = ?)
		  ORDER BY rank LIMIT ?`,
		match, folder, folder, kind, kind, docID, docID, limit)
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

func sortHits(hs []hit) {
	// insertion sort — candidate sets here are tiny.
	for i := 1; i < len(hs); i++ {
		for j := i; j > 0 && hs[j].Score > hs[j-1].Score; j-- {
			hs[j], hs[j-1] = hs[j-1], hs[j]
		}
	}
}

type chunkRow struct {
	Folder   string `json:"folder"`
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Topic    string `json:"topic"`
	Heading  string `json:"heading"`
	Summary  string `json:"summary"`
	Keywords string `json:"keywords"`
	Seq      int    `json:"seq"`
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
