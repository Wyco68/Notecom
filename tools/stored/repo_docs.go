package main

import (
	"database/sql"
	"errors"
)

type DocumentRepo struct{ db *database }

func newDocumentRepo(db *database) *DocumentRepo { return &DocumentRepo{db: db} }

const docCols = `id, folder_id, kind, doc_key, slug, title, seq, html, created_at, updated_at, version, deleted`

// Same columns qualified with the documents alias `d`, for queries that JOIN
// folders (which also has id/slug/title/version/deleted).
const docColsQ = `d.id, d.folder_id, d.kind, d.doc_key, d.slug, d.title, d.seq, d.html, d.created_at, d.updated_at, d.version, d.deleted`

func scanDoc(s interface {
	Scan(...any) error
}) (*Document, error) {
	var d Document
	var deleted int
	if err := s.Scan(&d.ID, &d.FolderID, &d.Kind, &d.DocKey, &d.Slug, &d.Title, &d.Seq,
		&d.HTML, &d.CreatedAt, &d.UpdatedAt, &d.Version, &deleted); err != nil {
		return nil, err
	}
	d.Deleted = deleted != 0
	return &d, nil
}

// GetByKey loads one active document by folder slug + kind + folder-local key.
func (r *DocumentRepo) GetByKey(folderSlug, kind, docKey string) (*Document, error) {
	row := r.db.sql.QueryRow(
		`SELECT `+docColsQ+` FROM documents d
		   JOIN folders f ON f.id = d.folder_id
		  WHERE f.slug = ? AND d.kind = ? AND d.doc_key = ? AND d.deleted = 0 AND f.deleted = 0`,
		folderSlug, kind, docKey,
	)
	d, err := scanDoc(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return d, err
}

// ListByFolderID returns active documents of a folder, ordered by kind then seq.
func (r *DocumentRepo) ListByFolderID(folderID string) ([]Document, error) {
	rows, err := r.db.sql.Query(
		`SELECT `+docCols+` FROM documents WHERE folder_id = ? AND deleted = 0 ORDER BY kind, seq`,
		folderID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Document
	for rows.Next() {
		d, err := scanDoc(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// treeDoc is one row of the single-query tree listing: a document's tree
// entry plus the slug of the folder it belongs to.
type treeDoc struct {
	FolderSlug string
	Kind       string
	DocKey     string
	Slug       string
	Title      string
	Seq        int
}

// ListActiveTree returns every active document across all active folders in
// one query (the /tree handler groups them in memory — no per-folder N+1).
func (r *DocumentRepo) ListActiveTree() ([]treeDoc, error) {
	rows, err := r.db.sql.Query(
		`SELECT f.slug, d.kind, d.doc_key, d.slug, d.title, d.seq
		   FROM documents d
		   JOIN folders f ON f.id = d.folder_id
		  WHERE d.deleted = 0 AND f.deleted = 0
		  ORDER BY f.slug, d.kind, d.seq`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []treeDoc
	for rows.Next() {
		var t treeDoc
		if err := rows.Scan(&t.FolderSlug, &t.Kind, &t.DocKey, &t.Slug, &t.Title, &t.Seq); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// SaveInput is a fully-resolved document supplied by the caller (Next.js on
// generation ingest, or the importer). stored never invents keys, slugs or
// seqs — that stays the app's job, exactly as with vaultd.
type SaveInput struct {
	FolderSlug string
	Kind       string
	DocKey     string
	Slug       string
	Title      string
	Seq        int
	HTML       string
}

// Save upserts a document keyed by (folder, kind, doc_key). An existing row is
// updated in place with its version bumped (the LWW conflict unit); a new row
// gets a fresh UUID. track=false (import) skips the sync enqueue.
func (r *DocumentRepo) Save(in SaveInput, track bool) (*Document, error) {
	tx, err := r.db.sql.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	fid, err := idBySlug(tx, in.FolderSlug)
	if err != nil {
		return nil, err
	}
	now := nowISO()

	var id string
	var version int
	var createdAt string
	err = tx.QueryRow(
		`SELECT id, version, created_at FROM documents WHERE folder_id = ? AND kind = ? AND doc_key = ?`,
		fid, in.Kind, in.DocKey,
	).Scan(&id, &version, &createdAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		id = newID()
		version = 1
		createdAt = now
		if _, err := tx.Exec(
			`INSERT INTO documents (`+docCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
			id, fid, in.Kind, in.DocKey, in.Slug, in.Title, in.Seq, in.HTML, createdAt, now,
		); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	default:
		version++
		if _, err := tx.Exec(
			`UPDATE documents SET slug = ?, title = ?, seq = ?, html = ?, updated_at = ?,
			        version = ?, deleted = 0 WHERE id = ?`,
			in.Slug, in.Title, in.Seq, in.HTML, now, version, id,
		); err != nil {
			return nil, err
		}
	}
	if track {
		if err := enqueue(tx, "documents", id, "upsert"); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &Document{
		ID: id, FolderID: fid, Kind: in.Kind, DocKey: in.DocKey, Slug: in.Slug,
		Title: in.Title, Seq: in.Seq, HTML: in.HTML, CreatedAt: createdAt,
		UpdatedAt: now, Version: version,
	}, nil
}

// Delete soft-deletes one document (tombstone) and enqueues the removal.
func (r *DocumentRepo) Delete(folderSlug, kind, docKey string, track bool) error {
	return r.mutateByKey(folderSlug, kind, docKey, track, "delete",
		`UPDATE documents SET deleted = 1, version = version + 1, updated_at = ? WHERE id = ?`)
}

// Rename updates a document's title only (id, key, slug and file identity are
// preserved — index-only, matching vaultd's rename semantics).
func (r *DocumentRepo) Rename(folderSlug, kind, docKey, newTitle string, track bool) error {
	return r.mutateByKey(folderSlug, kind, docKey, track, "upsert",
		`UPDATE documents SET title = ?, version = version + 1, updated_at = ? WHERE id = ?`,
		newTitle)
}

// mutateByKey resolves a document by key, applies the given UPDATE (whose
// trailing bind params are updated_at then id, with any extras prepended),
// and enqueues the sync op — all in one transaction.
func (r *DocumentRepo) mutateByKey(folderSlug, kind, docKey string, track bool, op, query string, pre ...any) error {
	tx, err := r.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var id string
	err = tx.QueryRow(
		`SELECT d.id FROM documents d JOIN folders f ON f.id = d.folder_id
		  WHERE f.slug = ? AND d.kind = ? AND d.doc_key = ? AND d.deleted = 0`,
		folderSlug, kind, docKey,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return errNotFound
	}
	if err != nil {
		return err
	}

	args := append(append([]any{}, pre...), nowISO(), id)
	if _, err := tx.Exec(query, args...); err != nil {
		return err
	}
	if track {
		if err := enqueue(tx, "documents", id, op); err != nil {
			return err
		}
	}
	return tx.Commit()
}
