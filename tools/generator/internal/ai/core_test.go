package ai

import (
	"context"
	"strings"
	"testing"
)

func TestReadSSE(t *testing.T) {
	body := "event: x\r\ndata: one\r\n\r\ndata:two\n: comment\ndata: [DONE]"
	var got []string
	if err := readSSE(strings.NewReader(body), func(d string) error { got = append(got, d); return nil }); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "one|two|[DONE]" {
		t.Fatalf("got %q", got)
	}
}

func TestCleanMessageScrubsTheKey(t *testing.T) {
	got := CleanMessage("bad key sk-secret-123\n\n  given", "sk-secret-123")
	if got != "bad key [key] given" {
		t.Fatalf("got %q", got)
	}
}

func TestChatRefusesBadModelIDs(t *testing.T) {
	for _, m := range []string{"", "../etc", "a b", "x..y"} {
		_, err := Chat(context.Background(), Request{Service: OpenAI, Model: m})
		if e, ok := err.(*Error); !ok || e.Kind != KindBadRequest {
			t.Errorf("model %q: %v", m, err)
		}
	}
}
