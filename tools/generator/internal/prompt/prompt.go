// Package prompt builds a lesson or quiz system prompt from the same
// template docs /lect and /quiz load: a port of systemPrompt in
// lib/generate/template.ts. The docs are read from DOCS_DIR (the image copies
// the repo's docs/), so one edit to a doc changes what every runner writes.
package prompt

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var docs = map[string][]string{
	"lect": {"teaching-guidelines.md", "html-output-contract.md", "lesson-template.md"},
	"quiz": {"quiz-guidelines.md"},
}

// Builder reads the docs once and caches the prompts.
type Builder struct {
	dir   string
	mu    sync.Mutex
	cache map[string]string
}

func New(dir string) *Builder { return &Builder{dir: dir, cache: map[string]string{}} }

// Check fails when a doc the prompts need is missing, so a bad image fails
// at start-up rather than on the first job.
func (b *Builder) Check() error {
	for _, kind := range []string{"lect", "quiz"} {
		if _, err := b.System(kind); err != nil {
			return err
		}
	}
	return nil
}

// System is the system prompt for "lect" or "quiz".
func (b *Builder) System(kind string) (string, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if s, ok := b.cache[kind]; ok {
		return s, nil
	}
	names, ok := docs[kind]
	if !ok {
		return "", fmt.Errorf("unknown kind %q", kind)
	}
	noun := "lesson"
	if kind == "quiz" {
		noun = "quiz"
	}
	lines := []string{
		fmt.Sprintf("You write a %s for Notecom from one uploaded lecture file, which is attached to the first message.", noun),
		"The documents below are the template and the output contract. Follow them exactly for structure, wording and markup.",
		"Ground every claim strictly in the attached source: do not invent, pad, or generalize beyond what it contains.",
		`If the source can't be read, reply with one line starting "CANNOT READ SOURCE:" and the reason, and nothing else.`,
	}
	if kind == "lect" {
		lines = append(lines, "No slide pictures are offered in this run, so do not use <figure> or <img>; explain any figure in words and with the contract's diagrams instead.")
	}
	lines = append(lines,
		fmt.Sprintf("The app checks your reply against the contract, names the %s from its <h1> and saves it.", noun),
		"Reply with only the complete HTML, starting at the <h1> — no code fence, no summary, and no text before or after it.",
	)
	var sb strings.Builder
	sb.WriteString(strings.Join(lines, "\n"))
	for _, name := range names {
		text, err := os.ReadFile(filepath.Join(b.dir, name))
		if err != nil {
			return "", fmt.Errorf("template doc: %w", err)
		}
		fmt.Fprintf(&sb, "\n\n# %s\n\n%s", name, text)
	}
	b.cache[kind] = sb.String()
	return b.cache[kind], nil
}
