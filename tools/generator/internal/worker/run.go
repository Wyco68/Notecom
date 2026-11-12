package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"time"
	"unicode/utf8"

	"notecom/generator/internal/ai"
	"notecom/generator/internal/source"
	"notecom/generator/internal/store"
	"notecom/generator/internal/uploads"
	"notecom/generator/internal/vault"
)

var (
	uuidRE   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	folderRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]*$`)
)

type outcome int

const (
	finished   outcome = iota // done or failed, and recorded
	lost                      // stopped by the reader, or taken over
	handedBack                // shutting down: saved and back in the queue
	dropped                   // progress couldn't be saved
)

func (o outcome) String() string {
	return [...]string{"finished", "lost", "handed back", "dropped"}[o]
}

// errLost: the job is no longer this worker's.
var errLost = errors.New("job lost")

// failure is a step failure whose message is written for the reader.
type failure struct{ msg string }

func (f *failure) Error() string { return f.msg }

// docState is what a lesson or quiz job keeps on its row between AI calls.
type docState struct {
	Started bool  `json:"started,omitempty"`
	Write   *conv `json:"write,omitempty"`
}

// conv is one ask → check → fix conversation: the last reply and the fix
// asked for, and the reply so far while one streams.
type conv struct {
	Round   int    `json:"round,omitempty"`
	Reply   string `json:"reply,omitempty"`
	Fix     string `json:"fix,omitempty"`
	Partial string `json:"partial,omitempty"`
}

type params struct {
	Folder  string           `json:"folder"`
	Uploads []uploads.Upload `json:"uploads"`
}

// run is one job being worked on.
type run struct {
	w      *Worker
	job    *store.Job
	msg    Msg
	params params
	label  string

	// call is the context of the AI call in flight; cancelled when the job
	// is lost or the process is stopping.
	call   context.Context
	cancel context.CancelFunc

	// mu guards the job's in-memory progress, which the heartbeat reads
	// while a call streams.
	mu      sync.Mutex
	log     []string
	state   docState
	status  string
	result  *store.Result
	tokIn   int64
	tokOut  int64
	keep    func(sofar string) // set while a call streams
	sofar   string
	isLost  bool
	writeMu sync.Mutex // orders progress writes by when they were taken

	key   string
	parts []ai.Part
}

func newRun(w *Worker, job *store.Job, msg Msg) *run {
	call, cancel := context.WithCancel(context.Background())
	r := &run{
		w: w, job: job, msg: msg,
		label:  ai.Service(job.Service).Label(),
		call:   call,
		cancel: cancel,
		log:    append([]string(nil), job.Log...),
		status: "running",
		result: job.Result,
		tokIn:  job.TokensIn,
		tokOut: job.TokensOut,
	}
	_ = json.Unmarshal(job.Params, &r.params)
	if len(job.State) > 0 {
		_ = json.Unmarshal(job.State, &r.state)
	}
	return r
}

func (r *run) stopping() bool {
	select {
	case <-r.w.stopping:
		return true
	default:
		return false
	}
}

// badParams re-checks the row: it is the only thing the worker goes by.
func (r *run) badParams() string {
	p := r.params
	if r.job.Kind != "lesson" && r.job.Kind != "quiz" {
		return "kind"
	}
	if !ai.Service(r.job.Service).Valid() {
		return "service"
	}
	if !folderRE.MatchString(p.Folder) {
		return "folder"
	}
	if len(p.Uploads) != 1 {
		return "uploads"
	}
	u := p.Uploads[0]
	n := utf8.RuneCountInString(u.Name)
	if !uploads.OwnPath(r.job.OwnerID, u.Path) || n < 1 || n > 200 || !uploads.ValidToken(u.Token) {
		return "uploads"
	}
	return ""
}

func (r *run) say(lines ...string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.log = append(r.log, lines...)
}

func (r *run) done(res *store.Result, line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.result = res
	r.status = "done"
	r.log = append(r.log, line, "Finished.")
}

func (r *run) fail(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.status = "error"
	r.log = append(r.log, line)
}

// snapshot is the progress to save; status overrides the run's own (the
// heartbeat always saves "running": it only renews the lease).
func (r *run) snapshot(status string) store.Progress {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.keep != nil && r.sofar != "" {
		r.keep(r.sofar)
	}
	state, _ := json.Marshal(r.state)
	if status == "" {
		status = r.status
	}
	return store.Progress{
		Status:    status,
		Log:       append([]string(nil), r.log...),
		State:     state,
		Result:    r.result,
		TokensIn:  r.tokIn,
		TokensOut: r.tokOut,
	}
}

// save writes progress; errLost when the job is no longer this worker's.
func (r *run) save(status string, stepDone bool) error {
	r.writeMu.Lock()
	defer r.writeMu.Unlock()
	p := r.snapshot(status)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if err = r.w.Store.SaveProgress(ctx, r.job, p, leaseSeconds, stepDone); err == nil || errors.Is(err, store.ErrNotHeld) {
			break
		}
		time.Sleep(time.Duration(attempt+1) * time.Second)
	}
	if errors.Is(err, store.ErrNotHeld) {
		r.mu.Lock()
		r.isLost = true
		r.mu.Unlock()
		r.cancel()
		return errLost
	}
	return err
}

// beat renews the lease and the message's ack wait until stop is closed.
func (r *run) beat(stop <-chan struct{}, wg *sync.WaitGroup) {
	defer wg.Done()
	t := time.NewTicker(r.w.Heartbeat)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-r.w.stopping:
			r.cancel()
			<-stop
			return
		case <-t.C:
			_ = r.msg.InProgress()
			if err := r.save("running", false); err != nil && !errors.Is(err, errLost) {
				r.w.Log.Warn("heartbeat save failed", "job", r.job.ID, "err", err)
			}
		}
	}
}

// work runs the job's steps until it ends.
func (r *run) work() outcome {
	defer r.cancel()
	if reason := r.badParams(); reason != "" {
		r.w.Log.Warn("refusing a job with bad params", "job", r.job.ID, "field", reason)
		r.fail("This run's request isn't valid, so nothing was done.")
		return r.final()
	}

	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go r.beat(stop, &wg)
	stopBeat := func() {
		if stop != nil {
			close(stop)
			wg.Wait()
			stop = nil
		}
	}
	defer stopBeat()

	for {
		if r.stopping() {
			stopBeat()
			return r.handBack()
		}
		stepDone := false
		err := r.documentStep()
		switch {
		case err == nil:
			stepDone = true
		case errors.Is(err, errLost), errors.Is(err, store.ErrNotHeld):
			return lost
		case r.aborted(err):
			stopBeat()
			if r.lostNow() {
				return lost
			}
			return r.handBack()
		default:
			r.fail(r.explain(err))
		}
		r.mu.Lock()
		running := r.status == "running"
		r.mu.Unlock()
		if !running {
			stopBeat()
			return r.final()
		}
		if err := r.save("", stepDone); err != nil {
			if errors.Is(err, errLost) {
				return lost
			}
			r.w.Log.Warn("progress save failed", "job", r.job.ID, "err", err)
			return dropped
		}
	}
}

func (r *run) lostNow() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.isLost
}

// aborted: the call was cut by this worker (job lost, or shutting down).
func (r *run) aborted(err error) bool {
	var aerr *ai.Error
	return r.call.Err() != nil || (errors.As(err, &aerr) && aerr.Kind == ai.KindAborted)
}

// final records how the job ended.
func (r *run) final() outcome {
	if err := r.save("", true); err != nil {
		if errors.Is(err, errLost) {
			return lost
		}
		r.w.Log.Warn("final save failed", "job", r.job.ID, "err", err)
		return dropped
	}
	return finished
}

// handBack saves what the job has — a reply cut short included, for the
// next worker to continue — and puts it back in the queue.
func (r *run) handBack() outcome {
	if err := r.save("queued", false); err != nil {
		if errors.Is(err, errLost) {
			return lost
		}
		return dropped
	}
	return handedBack
}

// explain is what the reader is told when a step fails: never a raw
// server message (lib/jobs/run.ts failure + context.ts explain).
func (r *run) explain(err error) string {
	var (
		aerr *ai.Error
		serr *source.Error
		gone *uploads.Gone
		ferr *failure
	)
	switch {
	case errors.As(err, &aerr):
		return explainAI(aerr, r.label)
	case errors.As(err, &serr):
		return "Failed: " + serr.Msg + "."
	case errors.As(err, &gone):
		return "Failed: " + gone.Error() + "."
	case errors.As(err, &ferr):
		return "Failed: " + ferr.msg + "."
	case errors.Is(err, store.ErrNotWritable):
		return "Failed: you can no longer write to this folder. Nothing was saved."
	}
	r.w.Log.Error("step failed", "job", r.job.ID, "err", err)
	return "Failed on the server. Nothing more was saved — try again."
}

func explainAI(err *ai.Error, label string) string {
	detail := ""
	if err.Message != "" {
		detail = " (" + err.Message + ")"
	}
	switch err.Kind {
	case ai.KindAuth:
		return fmt.Sprintf("%s didn't accept the key%s. Check it in the Generate dialog.", label, detail)
	case ai.KindRate:
		return fmt.Sprintf("%s says the rate limit or quota is used up. Wait a bit, then try again.%s", label, detail)
	case ai.KindBadRequest:
		return fmt.Sprintf("%s refused the request%s.", label, detail)
	case ai.KindRefused:
		return "The model declined to write this one."
	case ai.KindNetwork:
		return fmt.Sprintf("Couldn't reach %s. Try again.", label)
	case ai.KindAborted:
		return "Stopped."
	}
	return fmt.Sprintf("%s failed%s.", label, detail)
}

// apiKey is the reader's key for the job's service, decrypted once per job.
func (r *run) apiKey() (string, error) {
	if r.key != "" {
		return r.key, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	stored, err := r.w.Store.Key(ctx, r.job)
	if err != nil {
		return "", err
	}
	if stored == "" {
		return "", &ai.Error{Kind: ai.KindAuth, Message: fmt.Sprintf("no %s key is saved — add it in the Generate dialog", r.label)}
	}
	key, err := r.w.Vault.Decrypt(r.job.OwnerID, r.job.Service, stored)
	if err != nil {
		msg := vault.ErrUnreadable.Error()
		return "", &ai.Error{Kind: ai.KindAuth, Message: msg}
	}
	r.key = key
	return key, nil
}

// source is the upload as message parts, read once per job.
func (r *run) source() ([]ai.Part, error) {
	if r.parts != nil {
		return r.parts, nil
	}
	ctx, cancel := context.WithTimeout(r.call, 3*time.Minute)
	defer cancel()
	u := r.params.Uploads[0]
	data, err := r.w.Uploads.Read(ctx, r.job.OwnerID, u)
	if err != nil {
		return nil, err
	}
	parts, err := source.Parts(u.Name, data)
	if err != nil {
		return nil, err
	}
	r.parts = parts
	return parts, nil
}

// ask makes one AI call with the reader's key. keep is given the reply so far
// before each heartbeat saves, so a call cut short can be continued.
func (r *run) ask(system string, turns []ai.Turn, keep func(sofar string)) (*ai.Result, error) {
	key, err := r.apiKey()
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.keep, r.sofar = keep, ""
	baseOut := r.tokOut
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.keep, r.sofar = nil, ""
		r.mu.Unlock()
	}()
	res, err := r.w.Chat(r.call, ai.Request{
		Service: ai.Service(r.job.Service),
		Key:     key,
		Model:   r.job.Model,
		System:  system,
		Turns:   turns,
		OnProgress: func(text string) {
			r.mu.Lock()
			r.sofar = text
			r.tokOut = baseOut + int64(len(text)/4)
			r.mu.Unlock()
		},
	})
	r.mu.Lock()
	defer r.mu.Unlock()
	if err != nil {
		// Keep what streamed, for the hand-back to save.
		if r.keep != nil && r.sofar != "" {
			r.keep(r.sofar)
		}
		r.tokOut = baseOut
		return nil, err
	}
	r.tokIn += res.Input
	r.tokOut = baseOut + res.Output
	return res, nil
}
