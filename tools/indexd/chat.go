package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

// POST /chat — "Ask My Notes": grounded chat over the vault.
//
// Retrieval and generation both happen here, all local: the question is
// answered by a local Ollama chat model whose context is only the top
// retrieved chunks (never whole lessons) — that bound is the entire token
// budget of the feature. Claude is not involved; the Claude Code CLI is
// used elsewhere (lesson generation jobs in the Next.js app), never here.
//
// Request:  { "message": "...", "history": [{"role":"user"|"assistant","content":"..."}] }
// Response: SSE stream —
//   event sources: {"sources":[chunkRow...]} (once, first)
//   event delta:   {"delta":"text fragment"}  (repeated)
//   event done:    {}                          (last)

const maxContextChunks = 6

func chatModel() string {
	if m := os.Getenv("CHAT_MODEL"); m != "" {
		return m
	}
	return "llama3.2"
}

type chatMsg struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func (s *server) handleChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "use POST")
		return
	}
	var body struct {
		Message string    `json:"message"`
		History []chatMsg `json:"history"`
		// The document open in the reader — retrieval prefers it.
		Folder string `json:"folder"`
		ID     string `json:"id"`
		Kind   string `json:"kind"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	body.Message = strings.TrimSpace(body.Message)
	if body.Message == "" {
		writeErr(w, http.StatusBadRequest, "missing message")
		return
	}
	if !s.embed.available() {
		writeErr(w, http.StatusServiceUnavailable, "ollama is not running — chat needs a local Ollama server")
		return
	}

	var qv []float32
	if v, err := s.embed.embedQuery(body.Message); err == nil {
		qv = v
	}

	// Current-document-first retrieval: chunks from the open document rank
	// ahead of the rest of the vault; the vault only fills remaining slots.
	var fused []hit
	hasDoc := false
	if f, ok1 := safeName(body.Folder); ok1 {
		if id, ok2 := safeName(body.ID); ok2 && validKind(body.Kind) {
			hasDoc = true
			kwDoc, err := s.db.keywordSearchDoc(body.Message, f, body.Kind, id, 30)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			var vecDoc []hit
			if qv != nil {
				vecDoc, _ = s.db.vectorSearchDoc(qv, f, body.Kind, id, 30)
			}
			fused = rrfMerge(kwDoc, vecDoc)
		}
	}
	if len(fused) < maxContextChunks {
		kw, err := s.db.keywordSearch(body.Message, "", "", 30)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		var vec []hit
		if qv != nil {
			vec, _ = s.db.vectorSearch(qv, "", "", 30)
		}
		seen := map[int64]bool{}
		for _, h := range fused {
			seen[h.ChunkID] = true
		}
		for _, h := range rrfMerge(kw, vec) {
			if !seen[h.ChunkID] {
				fused = append(fused, h)
			}
		}
	}
	if len(fused) > maxContextChunks {
		fused = fused[:maxContextChunks]
	}
	sources, err := s.resolveHits(fused, false)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	messages := buildChatMessages(body.Message, body.History, sources, s.db, hasDoc)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	sse := func(event string, v any) {
		data, _ := json.Marshal(v)
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
		flusher.Flush()
	}
	sse("sources", map[string]any{"sources": sources})

	if err := s.streamOllamaChat(messages, func(delta string) {
		sse("delta", map[string]string{"delta": delta})
	}); err != nil {
		sse("error", map[string]string{"error": err.Error()})
		return
	}
	sse("done", map[string]string{})
}

// buildChatMessages assembles the grounded prompt. Context uses chunk
// *text* (not HTML) — same content, fewer tokens. History is capped so a
// long conversation can't grow the prompt unbounded.
func buildChatMessages(question string, history []chatMsg, sources []chunkRow, d *database, hasDoc bool) []chatMsg {
	var ctx strings.Builder
	for i, src := range sources {
		text := chunkText(d, src)
		fmt.Fprintf(&ctx, "[%d] %s — %s (%s)\n%s\n\n", i+1, src.Title, src.Heading, src.Folder, text)
	}

	scope := ""
	if hasDoc {
		scope = "The first sections come from the note the user currently has open; prefer them. "
	}
	system := "You are a study assistant for a personal lesson vault. " +
		"Answer using ONLY the numbered context sections below. " + scope +
		"Cite sections as [1], [2] where used. " +
		"You have no internet access and must never use outside knowledge. " +
		"If the context does not contain the answer, reply that it is not present in the notes (name which subject might cover it) — never invent facts.\n\n" +
		"Format every answer as clean Markdown so it reads like a study note, matching the style of the lessons themselves:\n" +
		"- Use ## for a section heading and ### for a sub-heading when the answer has distinct parts.\n" +
		"- Put **key terms** in bold and wrap commands, filenames, or literal values in `backticks`.\n" +
		"- Use `-` bullet lists for enumerations and `1.` for ordered steps.\n" +
		"- Keep paragraphs short. Never return one dense wall of text.\n\n" +
		"Context:\n" + ctx.String()

	msgs := []chatMsg{{Role: "system", Content: system}}
	if len(history) > 8 {
		history = history[len(history)-8:]
	}
	msgs = append(msgs, history...)
	msgs = append(msgs, chatMsg{Role: "user", Content: question})
	return msgs
}

// chunkText fetches a hit's plain text, truncated to keep the prompt small.
func chunkText(d *database, src chunkRow) string {
	var text string
	err := d.sql.QueryRow(
		`SELECT c.text FROM chunks c
		   JOIN documents dc ON dc.doc_id = c.doc_id
		  WHERE dc.folder=? AND dc.id=? AND dc.kind=? AND c.seq=?`,
		src.Folder, src.ID, src.Kind, src.Seq).Scan(&text)
	if err != nil {
		return src.Summary
	}
	r := []rune(text)
	if len(r) > 2500 {
		return string(r[:2500]) + "…"
	}
	return text
}

func (s *server) streamOllamaChat(messages []chatMsg, onDelta func(string)) error {
	payload, err := json.Marshal(map[string]any{
		"model":    chatModel(),
		"messages": messages,
		"stream":   true,
	})
	if err != nil {
		return err
	}
	resp, err := s.embed.client.Post(s.embed.url+"/api/chat", "application/json", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var apiErr struct {
			Error string `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&apiErr)
		return fmt.Errorf("ollama %d: %s", resp.StatusCode, apiErr.Error)
	}
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		var line struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			Done bool `json:"done"`
		}
		if err := json.Unmarshal(sc.Bytes(), &line); err != nil {
			continue
		}
		if line.Message.Content != "" {
			onDelta(line.Message.Content)
		}
		if line.Done {
			break
		}
	}
	return sc.Err()
}
