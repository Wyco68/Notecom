// Package parity loads testdata/parity.json, written by
// testdata/parity.mjs from the app's own TypeScript, for the Go tests that
// must agree with it.
package parity

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

type Chunk struct {
	Idx          int    `json:"idx"`
	Topic        string `json:"topic"`
	Heading      string `json:"heading"`
	HeadingIndex int    `json:"heading_index"`
	Summary      string `json:"summary"`
	Keywords     string `json:"keywords"`
	Body         string `json:"body"`
	HTML         string `json:"html"`
}

type Case struct {
	Name        string   `json:"name"`
	Input       string   `json:"input"`
	CheckLesson []string `json:"checkLesson"`
	CheckQuiz   []string `json:"checkQuiz"`
	ExtractHTML *string  `json:"extractHtml"`
	TitleOf     string   `json:"titleOf"`
	ChunkTitle  string   `json:"chunkTitle"`
	Chunks      []Chunk  `json:"chunks"`
}

type Data struct {
	Media string `json:"media"`
	Cases []Case `json:"cases"`
	Slugs []struct {
		Title string `json:"title"`
		Slug  string `json:"slug"`
	} `json:"slugs"`
	Vault struct {
		Secret  string `json:"secret"`
		Owner   string `json:"owner"`
		Service string `json:"service"`
		Stored  string `json:"stored"`
		Plain   string `json:"plain"`
	} `json:"vault"`
}

// Load reads the fixtures; it panics, since a test without them proves nothing.
func Load() Data {
	_, file, _, _ := runtime.Caller(0)
	raw, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "testdata", "parity.json"))
	if err != nil {
		panic(err)
	}
	var d Data
	if err := json.Unmarshal(raw, &d); err != nil {
		panic(err)
	}
	return d
}
