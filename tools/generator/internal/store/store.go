// Package store is the generator's whole database surface: one method per
// notes_gen_* function (migration 0036). The generator connects as the
// notes_generator role, which may call those functions and nothing else — no
// table is read or written directly, so this file is the complete list of
// what the generator can do to the database.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Job is a notes_jobs row, as the claim returns it.
type Job struct {
	ID        string          `json:"id"`
	OwnerID   string          `json:"owner_id"`
	FolderID  string          `json:"folder_id"`
	Kind      string          `json:"kind"`
	Service   string          `json:"service"`
	Model     string          `json:"model"`
	Status    string          `json:"status"`
	Params    json.RawMessage `json:"params"`
	State     json.RawMessage `json:"state"`
	Log       []string        `json:"log"`
	TokensIn  int64           `json:"tokens_in"`
	TokensOut int64           `json:"tokens_out"`
	Result    *Result         `json:"result"`
	Attempts  int             `json:"attempts"`
	Worker    string          `json:"worker"`
	CreatedAt time.Time       `json:"created_at"`
}

// Result is the document a job saved.
type Result struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Progress is what a worker saves on its job.
type Progress struct {
	Status    string
	Log       []string
	State     json.RawMessage
	Result    *Result
	TokensIn  int64
	TokensOut int64
}

// Doc is a document already in the job's folder.
type Doc struct {
	Key     string
	Title   string
	Seq     int
	Deleted bool
}

// OutboxMsg is one message waiting to be published.
type OutboxMsg struct {
	ID    int64
	JobID string
	Kind  string
	Event string
}

// ErrNotHeld: the job is no longer this worker's (stopped, or taken over).
var ErrNotHeld = errors.New("job not held")

// ErrNotWritable: the job's owner may no longer write its folder.
var ErrNotWritable = errors.New("folder not writable")

type Store struct{ pool *pgxpool.Pool }

// Open connects with at most maxConns pooled connections (plus the relay's
// one listening connection, opened separately).
func Open(ctx context.Context, url string, maxConns int32) (*Store, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MaxConnIdleTime = 5 * time.Minute
	cfg.HealthCheckPeriod = 30 * time.Second
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Config is for the relay's dedicated LISTEN connection.
func (s *Store) Config() *pgx.ConnConfig { return s.pool.Config().ConnConfig.Copy() }

// Claim takes job id for a fresh lease, or returns nil when it isn't
// claimable (finished, stopped, or held by a live worker).
func (s *Store) Claim(ctx context.Context, id string, leaseSeconds int) (*Job, error) {
	var raw []byte
	err := s.pool.QueryRow(ctx, `select to_jsonb(j) from public.notes_gen_claim($1, $2) j`, id, leaseSeconds).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var j Job
	if err := json.Unmarshal(raw, &j); err != nil {
		return nil, err
	}
	return &j, nil
}

// SaveProgress writes the worker's progress; ErrNotHeld when the job is no
// longer this worker's.
func (s *Store) SaveProgress(ctx context.Context, j *Job, p Progress, leaseSeconds int, stepDone bool) error {
	var result any
	if p.Result != nil {
		result = p.Result
	}
	state := p.State
	if len(state) == 0 {
		state = json.RawMessage(`{}`)
	}
	var ok bool
	err := s.pool.QueryRow(ctx,
		`select public.notes_gen_progress($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10)`,
		j.ID, j.Worker, p.Status, p.Log, string(state), result, p.TokensIn, p.TokensOut, leaseSeconds, stepDone,
	).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotHeld
	}
	return nil
}

// Key is the job owner's encrypted key for the job's service; empty when
// none is saved.
func (s *Store) Key(ctx context.Context, j *Job) (string, error) {
	var owner, service, ciphertext string
	err := s.pool.QueryRow(ctx, `select owner_id::text, service, ciphertext from public.notes_gen_key($1, $2)`, j.ID, j.Worker).
		Scan(&owner, &service, &ciphertext)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", notHeld(err)
	}
	if owner != j.OwnerID || service != j.Service {
		return "", errors.New("key row does not match the job")
	}
	return ciphertext, nil
}

// Docs lists the job folder's documents of kind ("lesson" or "quiz"),
// renumbered without gaps first.
func (s *Store) Docs(ctx context.Context, j *Job, kind string) ([]Doc, error) {
	rows, err := s.pool.Query(ctx, `select doc_key, title, seq, deleted from public.notes_gen_docs($1, $2, $3)`, j.ID, j.Worker, kind)
	if err != nil {
		return nil, notHeld(err)
	}
	docs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Doc, error) {
		var d Doc
		return d, r.Scan(&d.Key, &d.Title, &d.Seq, &d.Deleted)
	})
	return docs, notHeld(err)
}

// SaveDoc writes a new document, its search chunks and the job's result in
// one transaction. Nil when the key is already taken.
func (s *Store) SaveDoc(ctx context.Context, j *Job, kind, key, slug, title string, seq int, html string, chunks any) (*Result, error) {
	chunkJSON, err := json.Marshal(chunks)
	if err != nil {
		return nil, err
	}
	var raw []byte
	err = s.pool.QueryRow(ctx,
		`select public.notes_gen_save_doc($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
		j.ID, j.Worker, kind, key, slug, title, seq, html, string(chunkJSON),
	).Scan(&raw)
	if err != nil {
		return nil, notHeld(err)
	}
	if raw == nil {
		return nil, nil
	}
	var r Result
	return &r, json.Unmarshal(raw, &r)
}

// PublishOutbox takes up to limit unpublished messages, hands each to
// publish in order, and marks the ones published — all in one transaction,
// whose row locks keep another relay off the same messages. A publish that
// fails stops the batch; the rest stay for the next round. Returns how many
// were taken.
func (s *Store) PublishOutbox(ctx context.Context, limit int, publish func(OutboxMsg) error) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `select id, job_id::text, kind, event from public.notes_gen_outbox_take($1)`, limit)
	if err != nil {
		return 0, err
	}
	msgs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (OutboxMsg, error) {
		var m OutboxMsg
		return m, r.Scan(&m.ID, &m.JobID, &m.Kind, &m.Event)
	})
	if err != nil {
		return 0, err
	}
	var done []int64
	var pubErr error
	for _, m := range msgs {
		if pubErr = publish(m); pubErr != nil {
			break
		}
		done = append(done, m.ID)
	}
	if len(done) > 0 {
		if _, err := tx.Exec(ctx, `select public.notes_gen_outbox_done($1)`, done); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(msgs), pubErr
}

// Sweep files again the VPS jobs whose message may have been lost.
func (s *Store) Sweep(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select public.notes_gen_outbox_sweep()`).Scan(&n)
	return n, err
}

// notHeld maps the functions' refusals to the errors the worker acts on.
func notHeld(err error) error {
	switch {
	case err == nil:
		return nil
	case strings.Contains(err.Error(), "job not held"):
		return ErrNotHeld
	case strings.Contains(err.Error(), "folder not writable"):
		return ErrNotWritable
	}
	return err
}
