package main

// Repository methods used only by the sync engine: reads that include
// tombstones (a deleted row must still upload), Last-Write-Wins application
// of remote rows (never enqueues — applying a pull must not echo back as a
// push), and the one-time bootstrap enumeration.

import (
	"database/sql"
	"errors"
)

func (r *FolderRepo) GetByID(id string) (*Folder, error) {
	row := r.db.sql.QueryRow(`SELECT `+folderCols+` FROM folders WHERE id = ?`, id)
	f, err := scanFolder(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return f, err
}

func (r *DocumentRepo) GetByID(id string) (*Document, error) {
	row := r.db.sql.QueryRow(`SELECT `+docCols+` FROM documents WHERE id = ?`, id)
	d, err := scanDoc(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errNotFound
	}
	return d, err
}

// remoteWins is the LWW policy: version decides, updated_at breaks ties.
// Equal version and timestamp means "same write" — ignore.
func remoteWins(remoteVersion, localVersion int, remoteUpdated, localUpdated string) bool {
	if remoteVersion != localVersion {
		return remoteVersion > localVersion
	}
	return remoteUpdated > localUpdated
}

// ApplyRemote upserts a remote folder row verbatim (remote version and
// timestamps are kept, nothing is enqueued). Returns true when the local row
// changed.
func (r *FolderRepo) ApplyRemote(f *Folder) (bool, error) {
	local, err := r.GetByID(f.ID)
	switch {
	case errors.Is(err, errNotFound):
		deleted := 0
		if f.Deleted {
			deleted = 1
		}
		_, err := r.db.sql.Exec(
			`INSERT INTO folders (`+folderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			f.ID, f.Slug, f.Name, f.CreatedAt, f.UpdatedAt, f.Version, deleted,
		)
		return err == nil, err
	case err != nil:
		return false, err
	}
	if !remoteWins(f.Version, local.Version, f.UpdatedAt, local.UpdatedAt) {
		return false, nil
	}
	deleted := 0
	if f.Deleted {
		deleted = 1
	}
	_, err = r.db.sql.Exec(
		`UPDATE folders SET slug = ?, name = ?, created_at = ?, updated_at = ?, version = ?, deleted = ? WHERE id = ?`,
		f.Slug, f.Name, f.CreatedAt, f.UpdatedAt, f.Version, deleted, f.ID,
	)
	return err == nil, err
}

// ApplyRemote upserts a remote document row under the same LWW policy.
func (r *DocumentRepo) ApplyRemote(d *Document) (bool, error) {
	local, err := r.GetByID(d.ID)
	switch {
	case errors.Is(err, errNotFound):
		deleted := 0
		if d.Deleted {
			deleted = 1
		}
		_, err := r.db.sql.Exec(
			`INSERT INTO documents (`+docCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			d.ID, d.FolderID, d.Kind, d.DocKey, d.Slug, d.Title, d.Seq, d.HTML,
			d.CreatedAt, d.UpdatedAt, d.Version, deleted,
		)
		return err == nil, err
	case err != nil:
		return false, err
	}
	if !remoteWins(d.Version, local.Version, d.UpdatedAt, local.UpdatedAt) {
		return false, nil
	}
	deleted := 0
	if d.Deleted {
		deleted = 1
	}
	_, err = r.db.sql.Exec(
		`UPDATE documents SET folder_id = ?, kind = ?, doc_key = ?, slug = ?, title = ?, seq = ?,
		        html = ?, created_at = ?, updated_at = ?, version = ?, deleted = ? WHERE id = ?`,
		d.FolderID, d.Kind, d.DocKey, d.Slug, d.Title, d.Seq, d.HTML,
		d.CreatedAt, d.UpdatedAt, d.Version, deleted, d.ID,
	)
	return err == nil, err
}

// bootstrapEnqueueAll queues an upsert for every folder and document row,
// tombstones included — the one-time "push all" that seeds the cloud with
// content that predates sync (imports deliberately never enqueue).
func (s *server) bootstrapEnqueueAll() (int, error) {
	tx, err := s.db.sql.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	n := 0
	for _, q := range []struct{ table, query string }{
		{"folders", `SELECT id FROM folders`},
		{"documents", `SELECT id FROM documents`},
	} {
		rows, err := tx.Query(q.query)
		if err != nil {
			return 0, err
		}
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return 0, err
			}
			ids = append(ids, id)
		}
		rows.Close()
		for _, id := range ids {
			if err := enqueue(tx, q.table, id, "upsert"); err != nil {
				return 0, err
			}
			n++
		}
	}
	return n, tx.Commit()
}

func (r *SyncRepo) getSetting(key string) (string, bool) {
	var v string
	err := r.db.sql.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if err != nil {
		return "", false
	}
	return v, true
}

func (r *SyncRepo) setSetting(key, value string) error {
	_, err := r.db.sql.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}
