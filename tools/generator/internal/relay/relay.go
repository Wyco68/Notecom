// Package relay moves outbox messages from Postgres to JetStream: the
// "message relay" of the transactional outbox. It wakes on the NOTIFY that
// notes_enqueue_job sends on commit, and polls as well in case a
// notification was missed; once a minute it asks the database to file again
// any job whose message may have been lost.
package relay

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"notecom/generator/internal/queue"
	"notecom/generator/internal/store"
)

const (
	batch     = 100
	pollEvery = 10 * time.Second
	sweepEach = time.Minute
	channel   = "notes_job_outbox"
)

type Relay struct {
	Store *store.Store
	Queue *queue.Queue
	Log   *slog.Logger
}

// Run publishes until ctx ends.
func (r *Relay) Run(ctx context.Context) {
	wake := make(chan struct{}, 1)
	go r.listen(ctx, wake)
	poll := time.NewTicker(pollEvery)
	defer poll.Stop()
	sweep := time.NewTicker(sweepEach)
	defer sweep.Stop()

	r.publish(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-poll.C:
		case <-sweep.C:
			if n, err := r.Store.Sweep(ctx); err != nil {
				r.Log.Warn("outbox sweep failed", "err", err)
			} else if n > 0 {
				r.Log.Info("filed again jobs whose message may be lost", "jobs", n)
			}
		}
		r.publish(ctx)
	}
}

// publish drains the outbox in batches.
func (r *Relay) publish(ctx context.Context) {
	for ctx.Err() == nil {
		n, err := r.Store.PublishOutbox(ctx, batch, func(m store.OutboxMsg) error {
			pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
			defer cancel()
			return r.Queue.Publish(pctx, queue.Message{JobID: m.JobID, Kind: m.Kind, OutboxID: m.ID})
		})
		if err != nil {
			r.Log.Warn("outbox publish failed", "err", err)
			return
		}
		if n > 0 {
			r.Log.Info("published outbox messages", "count", n)
		}
		if n < batch {
			return
		}
	}
}

// listen holds one connection on LISTEN and nudges wake on every NOTIFY,
// reconnecting with a backoff when the connection drops.
func (r *Relay) listen(ctx context.Context, wake chan<- struct{}) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := func() error {
			conn, err := pgx.ConnectConfig(ctx, r.Store.Config())
			if err != nil {
				return err
			}
			defer conn.Close(context.Background())
			if _, err := conn.Exec(ctx, "listen "+channel); err != nil {
				return err
			}
			backoff = time.Second
			for {
				if _, err := conn.WaitForNotification(ctx); err != nil {
					return err
				}
				select {
				case wake <- struct{}{}:
				default:
				}
			}
		}()
		if ctx.Err() != nil {
			return
		}
		r.Log.Warn("outbox listener dropped; polling until it reconnects", "err", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < time.Minute {
			backoff *= 2
		}
	}
}
