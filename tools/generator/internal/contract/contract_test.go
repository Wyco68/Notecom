package contract

import (
	"slices"
	"testing"

	"notecom/generator/internal/parity"
)

func TestParityWithTypeScript(t *testing.T) {
	d := parity.Load()
	for _, c := range d.Cases {
		t.Run(c.Name, func(t *testing.T) {
			if got := CheckLesson(c.Input); !slices.Equal(got, nonNil(c.CheckLesson)) {
				t.Errorf("CheckLesson\n got %q\nwant %q", got, c.CheckLesson)
			}
			if got := CheckQuiz(c.Input); !slices.Equal(got, nonNil(c.CheckQuiz)) {
				t.Errorf("CheckQuiz\n got %q\nwant %q", got, c.CheckQuiz)
			}
			got, ok := ExtractHTML(c.Input)
			if ok != (c.ExtractHTML != nil) || (ok && got != *c.ExtractHTML) {
				t.Errorf("ExtractHTML got %q (%v), want %v", got, ok, c.ExtractHTML)
			}
			if got := TitleOf(c.Input); got != c.TitleOf {
				t.Errorf("TitleOf got %q, want %q", got, c.TitleOf)
			}
		})
	}
	for _, s := range d.Slugs {
		if got := Slug(s.Title); got != s.Slug {
			t.Errorf("Slug(%q) = %q, want %q", s.Title, got, s.Slug)
		}
	}
}

func TestSlugIsCapped(t *testing.T) {
	long := ""
	for i := 0; i < 50; i++ {
		long += "word "
	}
	s := Slug(long)
	if len(s) > 120 || s[len(s)-1] == '-' {
		t.Fatalf("slug %q not capped cleanly", s)
	}
}

func nonNil(s []string) []string {
	if s == nil {
		return nil
	}
	if len(s) == 0 {
		return nil
	}
	return s
}
