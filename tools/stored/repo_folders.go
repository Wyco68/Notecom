package main

import (
	"database/sql"
	"errors"
)

var errNotFound = errors.New("not found")

type FolderRepo struct{ db *database }

func newFolderRepo(db *database) *FolderRepo { return &FolderRepo{db: db} }

func scanFolder(s interface {
	Scan(...any) error
}) (*Folder, error) {
	var f Folder
	var deleted int
	if err := s.Scan(&f.ID, &f.Slug, &f.Name, &f.CreatedAt, &f.UpdatedAt, &f.Version, &deleted); err != nil {
		return nil, err
	}
	f.Deleted = deleted != 0
	return &f, nil
}

const folderCols = `id, slug, name, created_at, updated_at, version, deleted`

// GetBySlug returns the active (non-deleted) folder for a slug.
func (r *FolderRepo) GetBySlug(slug string) (*Folder, error) {
	row := r.db.sql.QueryRow(
		`SELECT `+folderCols+` FROM folders WHERE slug = ? AND deleted = 0`, slug)
	f, err := scanFolder(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return f, err
}

// idBySlug resolves a folder slug to its UUID inside a transaction.
func idBySlug(tx *sql.Tx, slug string) (string, error) {
	var id string
	err := tx.QueryRow(`SELECT id FROM folders WHERE slug = ? AND deleted = 0`, slug).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errNotFound
	}
	return id, err
}

// Create inserts a folder (idempotent on slug: an existing active folder is
// returned unchanged). When track is true the insert enqueues a sync upsert;
// import passes track=false so a scan of the vault leaves the queue empty.
func (r *FolderRepo) Create(slug, name string, track bool) (*Folder, error) {
	if existing, err := r.GetBySlug(slug); err == nil {
		return existing, nil
	} else if !errors.Is(err, errNotFound) {
		return nil, err
	}
	tx, err := r.db.sql.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	now := nowISO()
	f := &Folder{ID: newID(), Slug: slug, Name: name, CreatedAt: now, UpdatedAt: now, Version: 1}
	if _, err := tx.Exec(
		`INSERT INTO folders (`+folderCols+`) VALUES (?, ?, ?, ?, ?, 1, 0)`,
		f.ID, f.Slug, f.Name, f.CreatedAt, f.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if track {
		if err := enqueue(tx, "folders", f.ID, "upsert"); err != nil {
			return nil, err
		}
	}
	return f, tx.Commit()
}

// Delete soft-deletes a folder and cascades a soft-delete to its documents,
// bumping each version and (when track) enqueuing one sync op per record — a
// tombstone that propagates the removal to other devices. A hard delete
// could not.
func (r *FolderRepo) Delete(slug string, track bool) error {
	tx, err := r.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	fid, err := idBySlug(tx, slug)
	if err != nil {
		return err
	}
	now := nowISO()

	docRows, err := tx.Query(`SELECT id FROM documents WHERE folder_id = ? AND deleted = 0`, fid)
	if err != nil {
		return err
	}
	var docIDs []string
	for docRows.Next() {
		var id string
		if err := docRows.Scan(&id); err != nil {
			docRows.Close()
			return err
		}
		docIDs = append(docIDs, id)
	}
	docRows.Close()

	if _, err := tx.Exec(
		`UPDATE documents SET deleted = 1, version = version + 1, updated_at = ? WHERE folder_id = ? AND deleted = 0`,
		now, fid,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE folders SET deleted = 1, version = version + 1, updated_at = ? WHERE id = ?`,
		now, fid,
	); err != nil {
		return err
	}
	if track {
		for _, id := range docIDs {
			if err := enqueue(tx, "documents", id, "delete"); err != nil {
				return err
			}
		}
		if err := enqueue(tx, "folders", fid, "delete"); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ListActive returns every non-deleted folder ordered by name.
func (r *FolderRepo) ListActive() ([]Folder, error) {
	rows, err := r.db.sql.Query(
		`SELECT ` + folderCols + ` FROM folders WHERE deleted = 0 ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Folder
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *f)
	}
	return out, rows.Err()
}
