package main

// Minimal Supabase PostgREST client — stdlib only, same rule as the rest of
// the sidecars (no SDK; a handful of endpoints' worth of REST is not worth a
// dependency).
//
// Auth is the signed-in user's access token, never a service-role key: see
// auth.go. Every request therefore passes through Row Level Security, so this
// worker can only sync folders the user owns or belongs to. A 403 is a normal
// answer ("you may read this folder but not write it"), not a transport fault
// — callers distinguish it via errForbidden.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// errForbidden marks an RLS refusal. Retrying will never help, so the sync
// worker drops the queued row instead of backing off forever.
var errForbidden = errors.New("forbidden by row level security")

type supabaseClient struct {
	baseURL string // https://<ref>.supabase.co
	anonKey string
	auth    *authenticator
	http    *http.Client
}

func newSupabaseClient(auth *authenticator) *supabaseClient {
	return &supabaseClient{
		baseURL: strings.TrimSuffix(os.Getenv("SUPABASE_URL"), "/"),
		anonKey: os.Getenv("SUPABASE_ANON_KEY"),
		auth:    auth,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *supabaseClient) enabled() bool {
	return c.baseURL != "" && c.anonKey != "" && c.auth != nil && c.auth.configured()
}

func (c *supabaseClient) do(method, path string, body any, prefer string) ([]byte, error) {
	data, status, err := c.attempt(method, path, body, prefer)
	// One retry on 401: the access token may have been revoked or rotated
	// server-side, in which case a fresh one succeeds immediately.
	if status == http.StatusUnauthorized {
		c.auth.invalidate()
		data, status, err = c.attempt(method, path, body, prefer)
	}
	if err != nil {
		return nil, err
	}
	if status == http.StatusForbidden {
		return nil, fmt.Errorf("%w: %s %s", errForbidden, method, path)
	}
	if status >= 300 {
		return nil, fmt.Errorf("supabase %s %s: %d: %s", method, path, status, truncate(string(data), 300))
	}
	return data, nil
}

func (c *supabaseClient) attempt(method, path string, body any, prefer string) ([]byte, int, error) {
	token, err := c.auth.token()
	if err != nil {
		return nil, 0, err
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.baseURL+path, rdr)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("apikey", c.anonKey)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return nil, res.StatusCode, err
	}
	return data, res.StatusCode, nil
}

// upsert writes a batch of rows (any JSON-marshalable slice) with
// merge-duplicates semantics keyed on id.
func (c *supabaseClient) upsert(table string, rows any) error {
	_, err := c.do(http.MethodPost, "/rest/v1/"+table+"?on_conflict=id", rows,
		"resolution=merge-duplicates,return=minimal")
	return err
}

// pullSince fetches rows whose server-assigned synced_at is after the cursor,
// oldest first. limit pages the result; callers loop until a short page.
// The cursor is a Postgres timestamptz ("...+00:00") — it must be
// query-escaped or PostgREST decodes the + as a space and rejects it.
func (c *supabaseClient) pullSince(table, cursor string, limit int, out any) error {
	q := fmt.Sprintf("/rest/v1/%s?select=*&order=synced_at.asc&limit=%d", table, limit)
	if cursor != "" {
		q += "&synced_at=gt." + url.QueryEscape(cursor)
	}
	data, err := c.do(http.MethodGet, q, nil, "")
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// selectWhere runs an arbitrary PostgREST GET and decodes it. Used for the
// small collaboration reads (folder access) that aren't part of the LWW sync
// cursor protocol.
func (c *supabaseClient) selectWhere(table, query string, out any) error {
	data, err := c.do(http.MethodGet, "/rest/v1/"+table+"?"+query, nil, "")
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// loadEnvFile seeds process env vars from a KEY=VALUE file (comments and
// blank lines ignored; existing env vars win). Lets the desktop app keep the
// Supabase credentials next to the database instead of requiring a shell
// profile: <data-dir>/sync.env.
func loadEnvFile(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range bytes.Split(data, []byte("\n")) {
		line = bytes.TrimSpace(line)
		if len(line) == 0 || line[0] == '#' {
			continue
		}
		eq := bytes.IndexByte(line, '=')
		if eq <= 0 {
			continue
		}
		key, val := string(line[:eq]), string(bytes.TrimSpace(line[eq+1:]))
		if os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}
