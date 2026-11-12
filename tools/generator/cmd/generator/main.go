// Command generator writes Notecom lessons and quizzes on the VPS.
//
// It is both halves of the transactional outbox: the relay, which publishes
// the messages notes_enqueue_job writes in the job's own transaction to NATS
// JetStream, and the worker, which consumes them and works each job to the
// end with the reader's own AI key. MODE=relay or MODE=worker runs one half;
// the default runs both in one process (a small VPS).
//
// Environment:
//
//	DATABASE_URL        notes_generator via the Supavisor session pooler
//	SUPABASE_URL        https://<ref>.supabase.co, for signed upload reads
//	AI_KEYS_SECRET      the app's own secret (lib/ai/vault.ts), base64
//	NATS_URL, NATS_TOKEN
//	DOCS_DIR            the template docs (default /app/docs)
//	WORKER_CONCURRENCY  jobs at once (default 2)
//	MODE                all | relay | worker (default all)
//	HEALTH_ADDR         default :8080 (inside the container only)
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	"notecom/generator/internal/prompt"
	"notecom/generator/internal/queue"
	"notecom/generator/internal/relay"
	"notecom/generator/internal/store"
	"notecom/generator/internal/uploads"
	"notecom/generator/internal/vault"
	"notecom/generator/internal/worker"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe the running generator's health endpoint and exit")
	flag.Parse()
	if *healthcheck {
		os.Exit(probe())
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("generator stopped", "err", err)
		os.Exit(1)
	}
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func need(name string) (string, error) {
	v := os.Getenv(name)
	if v == "" {
		return "", fmt.Errorf("%s is not set", name)
	}
	return v, nil
}

func run(log *slog.Logger) error {
	mode := env("MODE", "all")
	if mode != "all" && mode != "relay" && mode != "worker" {
		return fmt.Errorf("MODE must be all, relay or worker")
	}
	concurrency, err := strconv.Atoi(env("WORKER_CONCURRENCY", "2"))
	if err != nil || concurrency < 1 || concurrency > 16 {
		return errors.New("WORKER_CONCURRENCY must be 1 to 16")
	}
	dbURL, err := need("DATABASE_URL")
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	startCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	st, err := store.Open(startCtx, dbURL, int32(concurrency+2))
	if err != nil {
		return err
	}
	defer st.Close()
	if err := st.Ping(startCtx); err != nil {
		return fmt.Errorf("database: %w", err)
	}
	q, err := queue.Open(startCtx, env("NATS_URL", "nats://nats:4222"), os.Getenv("NATS_TOKEN"), concurrency+1)
	if err != nil {
		return err
	}
	defer q.Close()

	var wg sync.WaitGroup
	if mode != "worker" {
		r := &relay.Relay{Store: st, Queue: q, Log: log.With("part", "relay")}
		wg.Add(1)
		go func() { defer wg.Done(); r.Run(ctx) }()
	}
	if mode != "relay" {
		w, err := newWorker(st, q, log.With("part", "worker"), concurrency)
		if err != nil {
			return err
		}
		wg.Add(1)
		go func() { defer wg.Done(); w.Run(ctx) }()
	}

	srv := &http.Server{Addr: env("HEALTH_ADDR", ":8080"), ReadHeaderTimeout: 5 * time.Second}
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		pctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if err := st.Ping(pctx); err != nil || !q.NC.IsConnected() {
			http.Error(w, "unhealthy", http.StatusServiceUnavailable)
			return
		}
		fmt.Fprintln(w, "ok")
	})
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("health endpoint failed", "err", err)
		}
	}()

	log.Info("generator started", "mode", mode, "concurrency", concurrency)
	<-ctx.Done()
	log.Info("shutting down: handing running jobs back")
	shutdown, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelShutdown()
	_ = srv.Shutdown(shutdown)
	wg.Wait()
	return nil
}

func newWorker(st *store.Store, q *queue.Queue, log *slog.Logger, concurrency int) (*worker.Worker, error) {
	secret, err := need("AI_KEYS_SECRET")
	if err != nil {
		return nil, err
	}
	v, err := vault.New(secret)
	if err != nil {
		return nil, err
	}
	supabaseURL, err := need("SUPABASE_URL")
	if err != nil {
		return nil, err
	}
	up, err := uploads.NewReader(supabaseURL)
	if err != nil {
		return nil, err
	}
	prompts := prompt.New(env("DOCS_DIR", "/app/docs"))
	if err := prompts.Check(); err != nil {
		return nil, err
	}
	return &worker.Worker{
		Store:       st,
		Consumer:    q.Consumer,
		Vault:       v,
		Uploads:     up,
		Prompts:     prompts,
		Log:         log,
		Concurrency: concurrency,
	}, nil
}

func probe() int {
	addr := env("HEALTH_ADDR", ":8080")
	if addr[0] == ':' {
		addr = "127.0.0.1" + addr
	}
	c := &http.Client{Timeout: 5 * time.Second}
	res, err := c.Get("http://" + addr + "/healthz")
	if err != nil {
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
