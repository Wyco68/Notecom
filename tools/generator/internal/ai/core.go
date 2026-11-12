// Package ai sends one conversation to whichever web service a reader picked,
// with the reader's own key. A port of lib/ai/*.ts: the same four services,
// each at a host fixed in its adapter, so a key is only ever sent to its own
// service — a job row names a service, never a URL.
package ai

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

// Service is one of the web services a reader can generate with.
type Service string

const (
	Anthropic  Service = "anthropic"
	OpenAI     Service = "openai"
	Gemini     Service = "gemini"
	OpenRouter Service = "openrouter"
)

// Label is the name the reader knows the service by (lib/ai/services.ts).
func (s Service) Label() string {
	switch s {
	case Anthropic:
		return "Claude API"
	case OpenAI:
		return "OpenAI API"
	case Gemini:
		return "Gemini API"
	case OpenRouter:
		return "OpenRouter"
	}
	return "The AI service"
}

// Valid reports whether s is one of the four services.
func (s Service) Valid() bool {
	switch s {
	case Anthropic, OpenAI, Gemini, OpenRouter:
		return true
	}
	return false
}

// ModelRE is a model id as every one of these services spells them.
var ModelRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$`)

// PartKind says what a Part carries.
type PartKind int

const (
	TextPart PartKind = iota
	PDFPart
	ImagePart
)

// Part is one piece of a message. File parts carry base64, encoded once when
// the upload is read rather than again on every request of a run.
type Part struct {
	Kind PartKind
	Text string // TextPart
	Data string // PDFPart, ImagePart: base64
	Name string // PDFPart
	Mime string // ImagePart
}

func Text(s string) Part { return Part{Kind: TextPart, Text: s} }

// Turn is one message of the conversation.
type Turn struct {
	Role  string // "user" or "assistant"
	Parts []Part
}

// Request is one call.
type Request struct {
	Service Service
	Key     string
	Model   string
	System  string
	Turns   []Turn
	// OnProgress is called as text streams in, with the reply so far.
	OnProgress func(text string)
}

// Result is the reply.
type Result struct {
	Text string
	// Truncated: the reply stopped at the model's output limit.
	Truncated bool
	Input     int64
	Output    int64
}

// ErrorKind is the kind of failure the reader can act on.
type ErrorKind string

const (
	KindAuth       ErrorKind = "auth"
	KindRate       ErrorKind = "rate"
	KindBadRequest ErrorKind = "bad-request"
	KindRefused    ErrorKind = "refused"
	KindNetwork    ErrorKind = "network"
	KindAborted    ErrorKind = "aborted"
	KindOther      ErrorKind = "other"
)

// Error is a failed call, with a message already scrubbed of the key.
type Error struct {
	Kind    ErrorKind
	Message string
}

func (e *Error) Error() string { return string(e.Kind) + ": " + e.Message }

func fail(kind ErrorKind, msg string) *Error { return &Error{Kind: kind, Message: msg} }

// CleanMessage is a provider's error text with the caller's key scrubbed,
// whitespace collapsed and the length capped.
func CleanMessage(msg, key string) string {
	if key != "" {
		msg = strings.ReplaceAll(msg, key, "[key]")
	}
	msg = strings.Join(strings.Fields(msg), " ")
	r := []rune(msg)
	if len(r) > 300 {
		r = r[:300]
	}
	return string(r)
}

// KindForStatus maps an HTTP status to the kind of failure the reader can act on.
func KindForStatus(status int) ErrorKind {
	switch {
	case status == 401 || status == 403:
		return KindAuth
	case status == 429:
		return KindRate
	case status >= 400 && status < 500:
		return KindBadRequest
	}
	return KindOther
}

// readSSE hands each `data:` payload of a text/event-stream body to onData.
func readSSE(body io.Reader, onData func(data string) error) error {
	sc := bufio.NewScanner(body)
	// A single event can carry a long chunk of text.
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for sc.Scan() {
		line := strings.TrimSuffix(sc.Text(), "\r")
		if strings.HasPrefix(line, "data:") {
			if err := onData(strings.TrimLeft(line[5:], " ")); err != nil {
				return err
			}
		}
	}
	return sc.Err()
}

// Chat sends the conversation to the service the request names.
func Chat(ctx context.Context, req Request) (*Result, error) {
	// Checked here, next to the call: the model id goes into a request path,
	// and a job row's copy of it is the reader's to change.
	if !ModelRE.MatchString(req.Model) || strings.Contains(req.Model, "..") {
		return nil, fail(KindBadRequest, "that model id isn't valid")
	}
	var (
		res *Result
		err error
	)
	switch req.Service {
	case Anthropic:
		res, err = chatAnthropic(ctx, req)
	case Gemini:
		res, err = chatGemini(ctx, req)
	case OpenAI, OpenRouter:
		res, err = chatOpenAICompatible(ctx, req)
	default:
		return nil, fail(KindBadRequest, "unknown service")
	}
	if err != nil && ctx.Err() != nil {
		return nil, fail(KindAborted, "Stopped.")
	}
	var aerr *Error
	if err != nil && !errors.As(err, &aerr) {
		return nil, fail(KindOther, CleanMessage(err.Error(), req.Key))
	}
	return res, err
}

// network wraps a transport failure.
func network(err error, key string) error {
	return fail(KindNetwork, CleanMessage(fmt.Sprint(err), key))
}
