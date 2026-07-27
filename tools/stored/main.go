// Command stored is the primary datastore service for Notes.
//
// Once the app runs on SQLite (the /feat offline-first migration), stored —
// not the filesystem — is the live source of truth. It owns one SQLite
// database (folders, documents, settings, sync_queue, sync_state), exposes a
// small HTTP CRUD API the Next.js app reads and writes through, and (Phase 4)
// runs the background sync worker that reconciles with Supabase.
//
// It follows the same rules as vaultd/indexd: pure-Go SQLite (no CGO, so
// Windows needs no C toolchain), stdlib HTTP only, and every id from a
// request validated by safeName before use. All naming/slug/seq logic stays
// in the app — stored persists fully-resolved values, it never invents them.
//
// The CRUD surface mirrors vaultd's contract 1:1 (routes.go); on top of it:
//
//	POST /import    scan vault/ into SQLite (disk wins; enqueues what changed
//	                so Claude-authored content reaches Supabase)
//	GET  /status    { ok, folders, queued, last_sync }
//
// After every DB mutation the change is replayed to vault/ by calling
// vaultd (export.go), keeping the file tree a live legacy-format export for
// indexd and Claude Code. Supabase sync (sync.go) authenticates as the
// signed-in user (auth.go), so Row Level Security — not this process — decides
// which folders it may read and write.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	gosync "sync"
	"syscall"
	"time"
)

type server struct {
	db      *database
	folders *FolderRepo
	docs    *DocumentRepo
	sync    *SyncRepo
	// mu serializes mutations against vault imports. Without it, a tree-fetch
	// import racing an in-app rename could read the not-yet-mirrored disk copy
	// and revert the DB. Single-user local service — contention is nil.
	mu gosync.Mutex
	// health is the sync worker's self-report, surfaced by GET /status so a
	// broken credential is visible without reading the log.
	health syncHealth
}

func main() {
	addr := os.Getenv("STORED_ADDR")
	if addr == "" {
		addr = "127.0.0.1:4323"
	}

	dbPath := os.Getenv("STORED_DB")
	if dbPath == "" {
		dbPath = filepath.Join(vaultRoot(), ".data", "notes.db")
	}
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		log.Fatal(err)
	}
	db, err := openDatabase(dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	s := &server{
		db:      db,
		folders: newFolderRepo(db),
		docs:    newDocumentRepo(db),
		sync:    newSyncRepo(db),
	}

	// First boot on an existing installation: seed SQLite from the legacy
	// vault so the app's switch from vaultd to stored loses nothing.
	s.importIfEmpty(vaultRoot())

	// Supabase credentials may live next to the database (<data>/sync.env)
	// instead of the shell environment — handy for the packaged desktop app.
	envPath := filepath.Join(filepath.Dir(dbPath), "sync.env")
	loadEnvFile(envPath)
	sb := newSupabaseClient(newAuthenticator(envPath))
	stop := make(chan struct{})
	if sb.enabled() {
		log.Printf("sync: enabled (%s)", sb.baseURL)
		s.health.Enabled = true
		go s.syncLoop(sb, stop)
	} else {
		// Name the missing piece. A half-filled sync.env (URL and key present,
		// credential blank) is the failure that looks like success: every
		// mutation still queues, nothing ever uploads, and the generic
		// "set these variables" line reads like a fully-local install.
		log.Printf("sync: DISABLED — %s. Fix in env or %s", sb.auth.missing(), envPath)
	}

	// Final queue flush on shutdown. Best-effort: the queue is durable, so a
	// hard kill loses nothing — the next start drains it.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		close(stop)
		if sb.enabled() {
			time.Sleep(2 * time.Second) // give the final push a moment
		}
		db.Close()
		os.Exit(0)
	}()

	mux := http.NewServeMux()
	s.routes(mux)

	log.Printf("stored listening on %s (db=%s)", addr, dbPath)
	if err := http.ListenAndServe(addr, authMiddleware(mux)); err != nil {
		log.Fatal(err)
	}
}

func (s *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	folders, err := s.folders.ListActive()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	depth, err := s.sync.queueDepth()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	last, _ := s.sync.lastSync()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"folders":   len(folders),
		"queued":    depth,
		"last_sync": last,
		"sync":      s.health.snapshot(),
	})
}

// authMiddleware gates every request behind STORED_TOKEN when set (needed if
// stored is ever reachable off-localhost); a no-op for the default local setup.
func authMiddleware(next http.Handler) http.Handler {
	token := os.Getenv("STORED_TOKEN")
	if token == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Auth-Token") != token {
			writeErr(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func vaultRoot() string {
	if r := os.Getenv("VAULT_ROOT"); r != "" {
		return r
	}
	return "vault"
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
