// Package worker consumes "job filed" messages from JetStream and works each
// job to the end: the Go counterpart of lib/jobs/run.ts, without the time
// limit that made the app's worker pause every few minutes.
//
// A message only says which job to look at; the job row is the truth. The
// worker claims the job (notes_gen_claim — atomic, so a duplicate message or
// a second worker gets nothing and acks), then runs its steps, one AI call
// each, saving progress after every step and every 15 seconds while a call
// streams. That save renews the 90-second lease and the message's ack wait
// together, so a worker that dies has its job taken over once both lapse.
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"notecom/generator/internal/ai"
	"notecom/generator/internal/prompt"
	"notecom/generator/internal/queue"
	"notecom/generator/internal/store"
	"notecom/generator/internal/uploads"
	"notecom/generator/internal/vault"
)

const (
	leaseSeconds = 90
	heartbeat    = 15 * time.Second
)

// Msg is the part of a JetStream message the worker uses.
type Msg interface {
	Data() []byte
	Ack() error
	NakWithDelay(time.Duration) error
	InProgress() error
	Term() error
}

// ChatFunc makes one AI call; ai.Chat in production.
type ChatFunc func(ctx context.Context, req ai.Request) (*ai.Result, error)

type Worker struct {
	Store       *store.Store
	Consumer    jetstream.Consumer
	Vault       *vault.Vault
	Uploads     *uploads.Reader
	Prompts     *prompt.Builder
	Chat        ChatFunc
	Log         *slog.Logger
	Concurrency int
	// Heartbeat is how often a running job saves progress and renews its
	// lease (default 15s; tests shorten it).
	Heartbeat time.Duration

	// stopping is closed when the process is shutting down: running jobs
	// stop their call, save what they have and hand the job back.
	stopping chan struct{}
	once     sync.Once
}

// Run pulls messages until ctx ends, then waits for running jobs to hand
// their work back.
func (w *Worker) Run(ctx context.Context) {
	w.init()
	sem := make(chan struct{}, max(w.Concurrency, 1))
	var wg sync.WaitGroup
	defer func() {
		w.once.Do(func() { close(w.stopping) })
		wg.Wait()
	}()
	for {
		select {
		case sem <- struct{}{}:
		case <-ctx.Done():
			return
		}
		// One message at a time, only once a slot is free: a message never
		// waits in this process while its ack wait runs down.
		msg, err := w.Consumer.Next(jetstream.FetchMaxWait(5 * time.Second))
		if err != nil {
			<-sem
			if ctx.Err() != nil {
				return
			}
			if !errors.Is(err, nats.ErrTimeout) && !errors.Is(err, jetstream.ErrNoMessages) {
				w.Log.Warn("fetch failed", "err", err)
				sleep(ctx, 2*time.Second)
			}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			w.Handle(msg)
		}()
	}
}

func (w *Worker) init() {
	if w.stopping == nil {
		w.stopping = make(chan struct{})
	}
	if w.Chat == nil {
		w.Chat = ai.Chat
	}
	if w.Heartbeat <= 0 {
		w.Heartbeat = heartbeat
	}
}

// Stop tells running jobs to hand their work back (tests; Run does it too).
func (w *Worker) Stop() { w.init(); w.once.Do(func() { close(w.stopping) }) }

// Handle works on the job one message names.
func (w *Worker) Handle(msg Msg) {
	w.init()
	var m queue.Message
	if err := json.Unmarshal(msg.Data(), &m); err != nil || !uuidRE.MatchString(m.JobID) {
		w.Log.Warn("dropping a malformed message")
		_ = msg.Term()
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	job, err := w.Store.Claim(ctx, m.JobID, leaseSeconds)
	cancel()
	if err != nil {
		w.Log.Warn("claim failed; will retry", "job", m.JobID, "err", err)
		_ = msg.NakWithDelay(15 * time.Second)
		return
	}
	if job == nil {
		// Finished, stopped, or another worker holds it: nothing to do.
		_ = msg.Ack()
		return
	}
	w.Log.Info("claimed job", "job", job.ID, "kind", job.Kind, "service", job.Service, "attempt", job.Attempts)
	switch outcome := newRun(w, job, msg).work(); outcome {
	case dropped:
		// The database couldn't be reached to record progress: leave the
		// job to lapse and have the message come back after the lease.
		_ = msg.NakWithDelay(2 * time.Minute)
	default:
		// Finished, stopped by the reader, taken over, or handed back (which
		// filed a new message): this delivery is done with.
		_ = msg.Ack()
		w.Log.Info("job left", "job", job.ID, "outcome", outcome.String())
	}
}

func sleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
