package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

// embedder talks to a local Ollama server. Availability is probed lazily
// and cached briefly so a down Ollama costs one failed dial per interval,
// not one per chunk — indexing and keyword search proceed without vectors.
type embedder struct {
	url    string
	model  string
	client *http.Client

	mu        sync.Mutex
	lastProbe time.Time
	up        bool
}

func newEmbedder() *embedder {
	url := os.Getenv("OLLAMA_URL")
	if url == "" {
		url = "http://127.0.0.1:11434"
	}
	model := os.Getenv("EMBED_MODEL")
	if model == "" {
		model = "nomic-embed-text"
	}
	return &embedder{url: url, model: model, client: &http.Client{Timeout: 120 * time.Second}}
}

func (e *embedder) available() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if time.Since(e.lastProbe) < 15*time.Second {
		return e.up
	}
	e.lastProbe = time.Now()
	probe := &http.Client{Timeout: 1500 * time.Millisecond}
	resp, err := probe.Get(e.url + "/api/tags")
	if err != nil {
		e.up = false
		return false
	}
	resp.Body.Close()
	e.up = resp.StatusCode == http.StatusOK
	return e.up
}

// embedBatch returns one vector per input, or an error (callers treat any
// failure as "no vectors this pass" — the scan backfills later).
func (e *embedder) embedBatch(inputs []string) ([][]float32, error) {
	body, err := json.Marshal(map[string]any{"model": e.model, "input": inputs})
	if err != nil {
		return nil, err
	}
	resp, err := e.client.Post(e.url+"/api/embed", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var apiErr struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&apiErr)
		return nil, fmt.Errorf("ollama %d: %s", resp.StatusCode, apiErr.Error)
	}
	var out struct {
		Embeddings [][]float32 `json:"embeddings"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Embeddings) != len(inputs) {
		return nil, fmt.Errorf("ollama returned %d embeddings for %d inputs", len(out.Embeddings), len(inputs))
	}
	return out.Embeddings, nil
}

// embedQuery embeds one search query, normalized for cosine-by-dot.
func (e *embedder) embedQuery(q string) ([]float32, error) {
	vs, err := e.embedBatch([]string{q})
	if err != nil {
		return nil, err
	}
	return normalize(vs[0]), nil
}
