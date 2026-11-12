package search

import (
	"testing"

	"notecom/generator/internal/parity"
)

func TestParityWithTypeScript(t *testing.T) {
	for _, c := range parity.Load().Cases {
		t.Run(c.Name, func(t *testing.T) {
			title, chunks := ChunkHTML(c.Input)
			if title != c.ChunkTitle {
				t.Errorf("title %q, want %q", title, c.ChunkTitle)
			}
			if len(chunks) != len(c.Chunks) {
				t.Fatalf("%d chunks, want %d\n got %+v", len(chunks), len(c.Chunks), chunks)
			}
			for i, w := range c.Chunks {
				g := chunks[i]
				got := parity.Chunk{Idx: g.Idx, Topic: g.Topic, Heading: g.Heading, HeadingIndex: g.HeadingIndex, Summary: g.Summary, Keywords: g.Keywords, Body: g.Body, HTML: g.HTML}
				if got != w {
					t.Errorf("chunk %d\n got %+v\nwant %+v", i, got, w)
				}
			}
		})
	}
}
