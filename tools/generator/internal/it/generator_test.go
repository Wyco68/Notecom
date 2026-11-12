//go:build integration

// End-to-end test of the outbox and the generator against a real Postgres
// and NATS (scripts/it.sh starts both in Docker): a reader files a job, the
// relay publishes it, the worker claims it, writes with a stand-in AI
// service, fixes a contract failure, saves the lesson with its chunks. Also:
// a shutdown mid-reply hands the job back and the next worker continues the
// reply; a reader's Stop is noticed mid-call; a folder the reader lost write
// access to is not written; and what each role may not do.
package it

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"notecom/generator/internal/ai"
	"notecom/generator/internal/prompt"
	"notecom/generator/internal/queue"
	"notecom/generator/internal/relay"
	"notecom/generator/internal/store"
	"notecom/generator/internal/uploads"
	"notecom/generator/internal/vault"
	"notecom/generator/internal/worker"
)

var (
	ownerA  = "aaaaaaaa-0000-4000-8000-000000000001"
	viewerB = "bbbbbbbb-0000-4000-8000-000000000002"
	editorC = "cccccccc-0000-4000-8000-000000000003"
	folderF = "f0f0f0f0-0000-4000-8000-00000000000f"
	secret  = base64.StdEncoding.EncodeToString(make([]byte, 32))
)

func repoRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "..", "..", "..", "..")
}

type env struct {
	t        *testing.T
	admin    *pgx.Conn
	genURL   string
	natsURL  string
	files    map[string][]byte // upload path -> bytes, served by the fake storage
	storage  *httptest.Server
	vault    *vault.Vault
	prompts  *prompt.Builder
	mu       sync.Mutex
	bucketMu sync.Mutex
}

func setup(t *testing.T) *env {
	adminURL, natsURL := os.Getenv("IT_ADMIN_URL"), os.Getenv("IT_NATS_URL")
	if adminURL == "" || natsURL == "" {
		t.Skip("IT_ADMIN_URL / IT_NATS_URL not set (run scripts/it.sh)")
	}
	ctx := context.Background()
	root, err := pgx.Connect(ctx, adminURL)
	must(t, err)
	db := fmt.Sprintf("notecom_it_%d", time.Now().UnixNano())
	_, err = root.Exec(ctx, "create database "+db)
	must(t, err)
	root.Close(ctx)

	u, _ := url.Parse(adminURL)
	u.Path = "/" + db
	admin, err := pgx.Connect(ctx, u.String())
	must(t, err)
	t.Cleanup(func() { admin.Close(context.Background()) })

	// Roles are cluster-wide: tolerate them existing from an earlier run.
	for _, r := range []string{"anon", "authenticated", "service_role", "notes_generator"} {
		_, _ = admin.Exec(ctx, fmt.Sprintf("drop owned by %s cascade", r))
	}
	stub, err := os.ReadFile(filepath.Join(repoRoot(), "tools/generator/internal/it/testdata/supabase_stub.sql"))
	must(t, err)
	stubSQL := string(stub)
	for _, r := range []string{"anon", "authenticated", "service_role"} {
		var exists bool
		must(t, admin.QueryRow(ctx, "select exists(select 1 from pg_roles where rolname=$1)", r).Scan(&exists))
		if exists {
			stubSQL = strings.Replace(stubSQL, "create role "+r+" ", "-- create role "+r+" ", 1)
		}
	}
	_, err = admin.Exec(ctx, stubSQL)
	must(t, err)
	mig, err := os.ReadFile(filepath.Join(repoRoot(), "supabase/migrations/0036_notes_generator_outbox.sql"))
	must(t, err)
	_, err = admin.Exec(ctx, string(mig))
	must(t, err)
	_, err = admin.Exec(ctx, "alter role notes_generator with login password 'it'")
	must(t, err)

	g := *u
	g.User = url.UserPassword("notes_generator", "it")
	e := &env{t: t, admin: admin, genURL: g.String(), natsURL: natsURL, files: map[string][]byte{}}

	v, err := vault.New(secret)
	must(t, err)
	e.vault = v
	e.prompts = prompt.New(filepath.Join(repoRoot(), "docs"))
	must(t, e.prompts.Check())

	e.storage = httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/storage/v1/object/sign/notes-job-uploads/")
		e.bucketMu.Lock()
		data, ok := e.files[path]
		e.bucketMu.Unlock()
		if !ok || r.URL.Query().Get("token") != tokenFor(path) {
			http.Error(w, "not found", 400)
			return
		}
		w.Write(data)
	}))
	t.Cleanup(e.storage.Close)

	e.exec(`insert into auth.users values ($1), ($2), ($3)`, ownerA, viewerB, editorC)
	e.exec(`insert into public.notes_folders (id, slug, name, owner_id) values ($1, 'Networks', 'Networks', $2)`, folderF, ownerA)
	e.exec(`insert into public.notes_folder_members (folder_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'viewer'), ($1, $4, 'editor')`,
		folderF, ownerA, viewerB, editorC)
	for _, who := range []string{ownerA, editorC} {
		e.exec(`insert into public.notes_ai_keys (owner_id, service, ciphertext, hint, model) values ($1, 'anthropic', $2, '1234', 'claude-opus-5-5')`,
			who, encrypt(t, who, "anthropic", "sk-ant-key-of-"+who[:8]))
	}
	return e
}

func tokenFor(path string) string {
	sum := sha256.Sum256([]byte(path))
	return "h." + base64.RawURLEncoding.EncodeToString(sum[:12]) + ".s"
}

func encrypt(t *testing.T, owner, service, key string) string {
	k, err := hkdf.Key(sha256.New, mustDecode(secret), nil, "notecom ai keys v1", 32)
	must(t, err)
	block, _ := aes.NewCipher(k)
	gcm, _ := cipher.NewGCM(block)
	iv := make([]byte, 12)
	_, _ = io.ReadFull(rand.Reader, iv)
	sealed := gcm.Seal(nil, iv, []byte(key), []byte(owner+"|"+service))
	body, tag := sealed[:len(sealed)-16], sealed[len(sealed)-16:]
	enc := base64.StdEncoding.EncodeToString
	return "v1:" + enc(iv) + ":" + enc(body) + ":" + enc(tag)
}

func mustDecode(s string) []byte { b, _ := base64.StdEncoding.DecodeString(s); return b }

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	e.mu.Lock()
	defer e.mu.Unlock()
	_, err := e.admin.Exec(context.Background(), sql, args...)
	must(e.t, err)
}

// asReader runs fn on a transaction as user uid, the way PostgREST would.
func (e *env) asReader(uid string, fn func(tx pgx.Tx) error) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	ctx := context.Background()
	tx, err := e.admin.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, uid); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, "set local role authenticated"); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// file uploads a source for uid and files a VPS job for it, as the app does.
func (e *env) file(uid, kind, name string, data []byte) string {
	e.t.Helper()
	path := fmt.Sprintf("%s/%s/%s", uid, newUUID(), name)
	e.bucketMu.Lock()
	e.files[path] = data
	e.bucketMu.Unlock()
	params, _ := json.Marshal(map[string]any{
		"folder":  "Networks",
		"uploads": []map[string]string{{"path": path, "name": name, "token": tokenFor(path)}},
	})
	var id string
	must(e.t, e.asReader(uid, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(),
			`select public.notes_enqueue_job($1, $2, 'anthropic', 'claude-opus-5-5', $3::jsonb, 'vps')`,
			folderF, kind, string(params)).Scan(&id)
	}))
	return id
}

func newUUID() string {
	b := make([]byte, 16)
	_, _ = io.ReadFull(rand.Reader, b)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type jobRow struct {
	Status string
	Log    []string
	Result map[string]string
	State  map[string]any
	TokOut int
	Worker *string
}

func (e *env) job(id string) jobRow {
	e.t.Helper()
	e.mu.Lock()
	defer e.mu.Unlock()
	var j jobRow
	var result, state []byte
	must(e.t, e.admin.QueryRow(context.Background(),
		`select status, log, result, state, tokens_out, worker::text from public.notes_jobs where id = $1`, id).
		Scan(&j.Status, &j.Log, &result, &state, &j.TokOut, &j.Worker))
	_ = json.Unmarshal(result, &j.Result)
	_ = json.Unmarshal(state, &j.State)
	return j
}

func (e *env) waitFor(id string, what string, ok func(jobRow) bool) jobRow {
	e.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if j := e.job(id); ok(j) {
			return j
		}
		time.Sleep(100 * time.Millisecond)
	}
	e.t.Fatalf("job %s never became %s; last: %+v", id, what, e.job(id))
	return jobRow{}
}

// generator is one running generator process (relay + worker).
type generator struct {
	cancel context.CancelFunc
	done   chan struct{}
	st     *store.Store
	q      *queue.Queue
}

func (e *env) start(chat worker.ChatFunc) *generator {
	e.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	st, err := store.Open(ctx, e.genURL, 3)
	must(e.t, err)
	q, err := queue.Open(ctx, e.natsURL, "", 3)
	must(e.t, err)
	up, err := uploads.NewReaderWithClient(e.storage.URL, e.storage.Client())
	must(e.t, err)
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	w := &worker.Worker{Store: st, Consumer: q.Consumer, Vault: e.vault, Uploads: up, Prompts: e.prompts,
		Chat: chat, Log: log, Concurrency: 2, Heartbeat: 300 * time.Millisecond}
	r := &relay.Relay{Store: st, Queue: q, Log: log}
	g := &generator{cancel: cancel, done: make(chan struct{}), st: st, q: q}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); r.Run(ctx) }()
	go func() { defer wg.Done(); w.Run(ctx) }()
	go func() { wg.Wait(); q.Close(); st.Close(); close(g.done) }()
	return g
}

func (g *generator) stop() { g.cancel(); <-g.done }

const goodLesson = `<h1>Routing Basics</h1>
<p>A <strong>router</strong> forwards packets.</p>
<h2>Concept: Routing Table</h2>
<p>Each entry maps a <code>prefix</code> to a next hop.</p>
<blockquote>Key Idea: the most specific route wins.</blockquote>
<h3>How it Works</h3><p>Longest prefix match.</p>`

func pdf() []byte { return []byte("%PDF-1.7\n% test source\n") }

func waitChan(t *testing.T, ch <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(30 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func TestLessonEndToEnd(t *testing.T) {
	e := setup(t)
	var mu sync.Mutex
	var calls []ai.Request
	g := e.start(func(ctx context.Context, req ai.Request) (*ai.Result, error) {
		mu.Lock()
		calls = append(calls, req)
		n := len(calls)
		mu.Unlock()
		if req.Key != "sk-ant-key-of-"+ownerA[:8] {
			return nil, &ai.Error{Kind: ai.KindAuth, Message: "wrong key " + req.Key}
		}
		if n == 1 {
			// Fails the contract: a forbidden heading.
			return &ai.Result{Text: "Sure!\n```html\n" + goodLesson + "\n<h2>Exam Tips</h2>\n```", Input: 1000, Output: 500}, nil
		}
		return &ai.Result{Text: goodLesson, Input: 1200, Output: 600}, nil
	})
	defer g.stop()

	id := e.file(ownerA, "lesson", "routing.pdf", pdf())
	j := e.waitFor(id, "done", func(j jobRow) bool { return j.Status == "done" || j.Status == "error" })
	if j.Status != "done" {
		t.Fatalf("job ended %s: %q", j.Status, j.Log)
	}
	if j.Result["id"] != "01-routing-basics" || j.Result["title"] != "Routing Basics" {
		t.Fatalf("result %+v", j.Result)
	}
	logText := strings.Join(j.Log, "\n")
	for _, want := range []string{"Queued on the generator.", "Writing the lesson…", "Contract check failed — asking Claude API to fix it (1 of 2).",
		"The lesson passed the contract check — saving it.", `Saved lesson "Routing Basics" to Networks.`, "Finished."} {
		if !strings.Contains(logText, want) {
			t.Errorf("log lacks %q:\n%s", want, logText)
		}
	}
	if j.TokOut != 1100 {
		t.Errorf("tokens_out %d, want 1100", j.TokOut)
	}
	if len(calls) != 2 {
		t.Fatalf("%d AI calls, want 2", len(calls))
	}
	second := calls[1]
	if len(second.Turns) != 3 || second.Turns[1].Role != "assistant" || !strings.Contains(second.Turns[2].Parts[0].Text, `standalone "Exam Tips" heading`) {
		t.Errorf("fix round turns: %+v", second.Turns)
	}
	if second.Turns[0].Parts[0].Kind != ai.PDFPart || !strings.Contains(second.System, "html-output-contract.md") {
		t.Errorf("first turn or system prompt wrong")
	}

	var docs, chunks int
	var html, key string
	must(t, e.admin.QueryRow(context.Background(),
		`select count(*), max(doc_key), max(html) from public.notes_documents where folder_id = $1 and kind = 'lesson'`, folderF).Scan(&docs, &key, &html))
	must(t, e.admin.QueryRow(context.Background(), `select count(*) from public.notes_doc_chunks where folder_id = $1`, folderF).Scan(&chunks))
	if docs != 1 || key != "01-routing-basics" || html != goodLesson || chunks != 3 {
		t.Fatalf("docs=%d key=%s chunks=%d html=%q", docs, key, chunks, html)
	}
	var unpublished int
	must(t, e.admin.QueryRow(context.Background(), `select count(*) from public.notes_job_outbox where published_at is null`).Scan(&unpublished))
	if unpublished != 0 {
		t.Errorf("%d outbox messages unpublished", unpublished)
	}

	// A second lesson with the same title is numbered after the first.
	id2 := e.file(ownerA, "lesson", "again.pdf", pdf())
	j2 := e.waitFor(id2, "done", func(j jobRow) bool { return j.Status == "done" || j.Status == "error" })
	if j2.Result["id"] != "02-routing-basics" {
		t.Fatalf("second lesson %s %+v %q", j2.Status, j2.Result, j2.Log)
	}

	// A duplicate message for a finished job changes nothing.
	must(t, g.q.Publish(context.Background(), queue.Message{JobID: id, Kind: "lesson", OutboxID: 999_999}))
	time.Sleep(time.Second)
	if again := e.job(id); again.Status != "done" || len(again.Log) != len(j.Log) {
		t.Fatalf("duplicate message changed the job: %+v", again)
	}

	permissions(t, e, id2)
}

// permissions: what each role may not do.
func permissions(t *testing.T, e *env, vpsJob string) {
	ctx := context.Background()
	denied := func(what string, err error) {
		t.Helper()
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
			t.Errorf("%s: want permission denied, got %v", what, err)
		}
	}

	// A reader can't reach the generator's functions or the outbox.
	for _, sql := range []string{
		`select public.notes_gen_claim('` + vpsJob + `', 90)`,
		`select public.notes_gen_outbox_sweep()`,
		`select * from public.notes_job_outbox`,
		`select public.notes_gen_save_doc('` + vpsJob + `', gen_random_uuid(), 'lesson', '09-x', 'x', 'x', 9, '<h1>x</h1>', '[]')`,
	} {
		err := e.asReader(ownerA, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql); return err })
		denied("reader: "+sql, err)
	}

	// A reader can't drive a VPS job through the web worker's functions, even
	// with its worker token in hand.
	must(t, e.asReader(ownerA, func(tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `select count(*) from public.notes_claim_job($1, 90)`, vpsJob).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			t.Error("the web claim took a VPS job")
		}
		var ok bool
		if err := tx.QueryRow(ctx, `select public.notes_job_progress($1, gen_random_uuid(), 'done', '{}', '{}', null, 0, 0, 90, true)`, vpsJob).Scan(&ok); err != nil {
			return err
		}
		if ok {
			t.Error("notes_job_progress wrote a VPS job")
		}
		return nil
	}))

	// A viewer can't file a job; nobody can send another kind to the VPS.
	err := e.asReader(viewerB, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `select public.notes_enqueue_job($1, 'lesson', 'anthropic', 'm', '{}', 'vps')`, folderF)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "folder not found") {
		t.Errorf("viewer filed a job: %v", err)
	}
	err = e.asReader(ownerA, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `select public.notes_enqueue_job($1, 'pictures', 'anthropic', 'm', '{}', 'vps')`, folderF)
		return err
	})
	if err == nil || !strings.Contains(err.Error(), "invalid job") {
		t.Errorf("filed a pictures job for the VPS: %v", err)
	}

	// The generator role reads and writes no table, and can't use the
	// readers' functions or the private helpers.
	gen, err := pgx.Connect(ctx, e.genURL)
	must(t, err)
	defer gen.Close(ctx)
	for _, sql := range []string{
		`select * from public.notes_jobs`,
		`select * from public.notes_documents`,
		`select * from public.notes_ai_keys`,
		`insert into public.notes_job_outbox (job_id, event) values ('` + vpsJob + `', 'filed')`,
		`select public.notes_enqueue_job('` + folderF + `', 'lesson', 'anthropic', 'm', '{}', 'vps')`,
		`select public.notes_cancel_job('` + vpsJob + `')`,
		`select public.notes_gen_held('` + vpsJob + `', gen_random_uuid())`,
		`select public.notes_gen_owner_can_write(j) from (select null::public.notes_jobs as j) s`,
	} {
		_, err := gen.Exec(ctx, sql)
		denied("generator: "+sql, err)
	}
	// And a worker token it doesn't hold gets it nothing.
	_, err = gen.Exec(ctx, `select * from public.notes_gen_key($1, gen_random_uuid())`, vpsJob)
	if err == nil || !strings.Contains(err.Error(), "job not held") {
		t.Errorf("notes_gen_key without the token: %v", err)
	}
}

func TestShutdownHandsBackAndNextWorkerContinues(t *testing.T) {
	e := setup(t)
	started := make(chan struct{})
	var startOnce sync.Once
	first := strings.Repeat("<h1>Quiz</h1>\n", 1) + "<h2>Q1. What forwards packets?</h2>\n" + strings.Repeat("<p>Filler line that is long enough to count.</p>\n", 30)
	g := e.start(func(ctx context.Context, req ai.Request) (*ai.Result, error) {
		req.OnProgress(first)
		startOnce.Do(func() { close(started) })
		<-ctx.Done()
		return nil, ctx.Err()
	})
	id := e.file(ownerA, "quiz", "q.md", []byte("# Routers\nThey forward packets."))
	waitChan(t, started, "the first call to start")
	g.stop()

	j := e.waitFor(id, "queued", func(j jobRow) bool { return j.Status == "queued" })
	write, _ := j.State["write"].(map[string]any)
	if partial, _ := write["partial"].(string); partial != first {
		t.Fatalf("hand-back kept %q", partial)
	}

	// The next generator continues the reply instead of starting again.
	rest := "<p>Filler line that is long enough to count.</p>\n<blockquote>Reasoning: routers forward.</blockquote>\n<blockquote>Answer: a router</blockquote>"
	var seen ai.Request
	g2 := e.start(func(ctx context.Context, req ai.Request) (*ai.Result, error) {
		seen = req
		return &ai.Result{Text: rest}, nil
	})
	defer g2.stop()
	j = e.waitFor(id, "done", func(j jobRow) bool { return j.Status == "done" || j.Status == "error" })
	if j.Status != "done" {
		t.Fatalf("continued job ended %s: %q", j.Status, j.Log)
	}
	n := len(seen.Turns)
	if n != 3 || seen.Turns[1].Parts[0].Text != first || !strings.Contains(seen.Turns[2].Parts[0].Text, "Continue it from exactly where it stops") {
		t.Fatalf("continuation turns: %+v", seen.Turns)
	}
	var html string
	must(t, e.admin.QueryRow(context.Background(), `select html from public.notes_documents where kind = 'quiz'`).Scan(&html))
	if !strings.HasSuffix(html, "<blockquote>Answer: a router</blockquote>") || strings.Count(html, "Filler line") != 30 {
		t.Fatalf("joined quiz wrong (overlap not removed?):\n%s", html)
	}
}

func TestReaderStopIsNoticedMidCall(t *testing.T) {
	e := setup(t)
	inCall := make(chan struct{})
	aborted := make(chan struct{})
	var once1, once2 sync.Once
	g := e.start(func(ctx context.Context, req ai.Request) (*ai.Result, error) {
		once1.Do(func() { close(inCall) })
		<-ctx.Done()
		once2.Do(func() { close(aborted) })
		return nil, ctx.Err()
	})
	defer g.stop()
	id := e.file(ownerA, "lesson", "s.pdf", pdf())
	waitChan(t, inCall, "the call to start")
	must(t, e.asReader(ownerA, func(tx pgx.Tx) error {
		_, err := tx.Exec(context.Background(), `select public.notes_cancel_job($1)`, id)
		return err
	}))
	select {
	case <-aborted:
	case <-time.After(10 * time.Second):
		t.Fatal("the call was not stopped")
	}
	time.Sleep(500 * time.Millisecond)
	if j := e.job(id); j.Status != "cancelled" {
		t.Fatalf("status %s after Stop", j.Status)
	}
}

func TestLostWriteAccessSavesNothing(t *testing.T) {
	e := setup(t)
	release := make(chan struct{})
	g := e.start(func(ctx context.Context, req ai.Request) (*ai.Result, error) {
		<-release
		return &ai.Result{Text: goodLesson}, nil
	})
	defer g.stop()
	id := e.file(editorC, "lesson", "c.pdf", pdf())
	e.waitFor(id, "running", func(j jobRow) bool { return j.Status == "running" })
	e.exec(`update public.notes_folder_members set role = 'viewer' where user_id = $1`, editorC)
	close(release)
	j := e.waitFor(id, "ended", func(j jobRow) bool { return j.Status == "done" || j.Status == "error" })
	if j.Status != "error" || !strings.Contains(strings.Join(j.Log, "\n"), "you can no longer write to this folder") {
		t.Fatalf("ended %s: %q", j.Status, j.Log)
	}
	var n int
	must(t, e.admin.QueryRow(context.Background(), `select count(*) from public.notes_documents`).Scan(&n))
	if n != 0 {
		t.Fatalf("%d documents saved without write access", n)
	}
}

func TestBadUploadTokenFailsForTheReader(t *testing.T) {
	e := setup(t)
	g := e.start(func(ctx context.Context, req ai.Request) (*ai.Result, error) {
		return &ai.Result{Text: goodLesson}, nil
	})
	defer g.stop()
	path := fmt.Sprintf("%s/%s/x.pdf", ownerA, newUUID())
	params, _ := json.Marshal(map[string]any{"folder": "Networks", "uploads": []map[string]string{{"path": path, "name": "x.pdf", "token": "a.b.c"}}})
	var id string
	must(t, e.asReader(ownerA, func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(), `select public.notes_enqueue_job($1, 'lesson', 'anthropic', 'claude-opus-5-5', $2::jsonb, 'vps')`, folderF, string(params)).Scan(&id)
	}))
	j := e.waitFor(id, "ended", func(j jobRow) bool { return j.Status == "done" || j.Status == "error" })
	if j.Status != "error" || !strings.Contains(strings.Join(j.Log, "\n"), `the upload "x.pdf" is gone`) {
		t.Fatalf("ended %s: %q", j.Status, j.Log)
	}
}
