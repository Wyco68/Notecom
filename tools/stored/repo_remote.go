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
	row := r.db.sql.QueryRow(folderSelect+` WHERE f.id = ?`, id)
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
		_, err := r.db.sql.Exec(
			`INSERT INTO folders (`+folderCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			f.ID, f.Slug, f.Name, nullable(f.OwnerID), nullable(f.Description), f.Visibility,
			boolInt(f.Discoverable), f.JoinPolicy, f.CreatedAt, f.UpdatedAt, f.Version, boolInt(f.Deleted),
		)
		return err == nil, err
	case err != nil:
		return false, err
	}
	if !remoteWins(f.Version, local.Version, f.UpdatedAt, local.UpdatedAt) {
		return false, nil
	}
	_, err = r.db.sql.Exec(
		`UPDATE folders SET slug = ?, name = ?, owner_id = ?, description = ?, visibility = ?,
		        discoverable = ?, join_policy = ?, created_at = ?, updated_at = ?, version = ?, deleted = ?
		  WHERE id = ?`,
		f.Slug, f.Name, nullable(f.OwnerID), nullable(f.Description), f.Visibility,
		boolInt(f.Discoverable), f.JoinPolicy, f.CreatedAt, f.UpdatedAt, f.Version, boolInt(f.Deleted), f.ID,
	)
	return err == nil, err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// nullable keeps an empty optional column NULL rather than "", so a folder
// that has not been claimed by a user is distinguishable from one whose owner
// is the empty string.
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ReplaceAccess swaps the whole cached role table for the rows just pulled.
// A full replace rather than an upsert: losing access is as important to
// reflect as gaining it, and the set is tiny.
func (r *FolderRepo) ReplaceAccess(roles map[string]string) error {
	tx, err := r.db.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM folder_access`); err != nil {
		return err
	}
	now := nowISO()
	for folderID, role := range roles {
		// Skip roles for folders this device hasn't pulled yet; the FK would
		// reject them and the next cycle picks them up.
		if _, err := tx.Exec(
			`INSERT INTO folder_access (folder_id, role, synced_at)
			 SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM folders WHERE id = ?)`,
			folderID, role, now, folderID,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ClaimUnowned stamps the signed-in user onto folders created before this
// device knew who it was. Without it, a locally-created folder would push with
// a null owner_id and be rejected by the folders INSERT policy.
func (r *FolderRepo) ClaimUnowned(userID string) (int64, error) {
	res, err := r.db.sql.Exec(
		`UPDATE folders SET owner_id = ? WHERE owner_id IS NULL OR owner_id = ''`, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
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
