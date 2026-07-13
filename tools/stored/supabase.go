package main

// Minimal Supabase PostgREST client — stdlib only, same rule as the rest of
// the sidecars (no SDK; two endpoints' worth of REST is not worth a
// dependency). Auth is the service-role key: the notes_* tables have RLS
// enabled with zero policies, so anon/authenticated roles can't touch them
// and the only writer is this worker. The key is loaded from the environment
// (optionally seeded from <data-dir>/sync.env) and never leaves the machine
// except as the Authorization header to Supabase itself.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"
)

type supabaseClient struct {
	baseURL string // https://<ref>.supabase.co
	key     string
	http    *http.Client
}

func newSupabaseClient() *supabaseClient {
	return &supabaseClient{
		baseURL: os.Getenv("SUPABASE_URL"),
		key:     os.Getenv("SUPABASE_SERVICE_KEY"),
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *supabaseClient) enabled() bool { return c.baseURL != "" && c.key != "" }

func (c *supabaseClient) do(method, path string, body any, prefer string) ([]byte, error) {
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.baseURL+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", c.key)
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Content-Type", "application/json")
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase %s %s: %d: %s", method, path, res.StatusCode, truncate(string(data), 300))
	}
	return data, nil
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
