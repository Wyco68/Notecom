package main

import "database/sql"

// enqueue records one pending mutation inside the caller's transaction, so a
// row and its sync intent commit atomically — the queue can never miss a
// mutation, and a mutation can never be "half synced". The worker (Phase 4)
// reads the live row at upload time, so multiple edits to the same record
// collapse to its latest state.
func enqueue(tx *sql.Tx, table, recordID, op string) error {
	now := nowISO()
	_, err := tx.Exec(
		`INSERT INTO sync_queue (table_name, record_id, operation, retry_count, next_attempt, created_at)
		 VALUES (?, ?, ?, 0, ?, ?)`,
		table, recordID, op, now, now,
	)
	return err
}

// queueItem is one drained sync_queue row (used by the Phase 4 worker).
type queueItem struct {
	ID         int64
	TableName  string
	RecordID   string
	Operation  string
	RetryCount int
}

type SyncRepo struct{ db *database }

func newSyncRepo(db *database) *SyncRepo { return &SyncRepo{db: db} }

// pending returns up to limit queue rows whose backoff gate has elapsed,
// oldest first (FIFO). next_attempt is compared as an ISO8601 string, which
// orders chronologically by construction (see nowISO).
func (r *SyncRepo) pending(limit int) ([]queueItem, error) {
	rows, err := r.db.sql.Query(
		`SELECT id, table_name, record_id, operation, retry_count
		   FROM sync_queue
		  WHERE next_attempt <= ?
		  ORDER BY id ASC
		  LIMIT ?`,
		nowISO(), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []queueItem
	for rows.Next() {
		var q queueItem
		if err := rows.Scan(&q.ID, &q.TableName, &q.RecordID, &q.Operation, &q.RetryCount); err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

func (r *SyncRepo) remove(id int64) error {
	_, err := r.db.sql.Exec(`DELETE FROM sync_queue WHERE id = ?`, id)
	return err
}

// defer reschedules a failed item with an exponential backoff gate.
func (r *SyncRepo) defer_(id int64, nextAttempt string) error {
	_, err := r.db.sql.Exec(
		`UPDATE sync_queue SET retry_count = retry_count + 1, next_attempt = ? WHERE id = ?`,
		nextAttempt, id,
	)
	return err
}

func (r *SyncRepo) lastSync() (string, error) {
	var v sql.NullString
	if err := r.db.sql.QueryRow(`SELECT last_sync FROM sync_state WHERE id = 1`).Scan(&v); err != nil {
		return "", err
	}
	return v.String, nil
}

func (r *SyncRepo) setLastSync(ts string) error {
	_, err := r.db.sql.Exec(`UPDATE sync_state SET last_sync = ? WHERE id = 1`, ts)
	return err
}

func (r *SyncRepo) queueDepth() (int, error) {
	var n int
	err := r.db.sql.QueryRow(`SELECT COUNT(*) FROM sync_queue`).Scan(&n)
	return n, err
}
