// Package search splits a lesson into educational sections for search: a
// port of lib/search/chunker.ts (itself ported from indexd's chunker.go).
// Every <h2> opens a topic, every <h3> a chunk inside it, content before the
// first heading lands in "Overview". The chunks a generated document is saved
// with must be the ones the app would have written, so testdata/parity.json
// (produced by the TypeScript chunker) is replayed by this package's tests.
package search

import (
	"regexp"
	"strings"
	"unicode/utf16"
)

// Chunk is one row of notes_doc_chunks.
type Chunk struct {
	Idx          int    `json:"idx"`
	Topic        string `json:"topic"`
	Heading      string `json:"heading"`
	HeadingIndex int    `json:"heading_index"`
	Summary      string `json:"summary"`
	Keywords     string `json:"keywords"`
	// Body is the plain text of the section — what full-text search matches.
	Body string `json:"body"`
	HTML string `json:"html"`
}

var (
	tagRE     = regexp.MustCompile(`<[^>]*>`)
	headingRE = regexp.MustCompile(`(?i)<(h[123])\b[^>]*>`)
	closeH    = map[string]*regexp.Regexp{
		"h1": regexp.MustCompile(`(?i)</h1\s*>`),
		"h2": regexp.MustCompile(`(?i)</h2\s*>`),
		"h3": regexp.MustCompile(`(?i)</h3\s*>`),
	}
	termRE = regexp.MustCompile(`(?i)<(strong|code)\b[^>]*>`)
	closeT = map[string]*regexp.Regexp{
		"strong": regexp.MustCompile(`(?i)</strong\s*>`),
		"code":   regexp.MustCompile(`(?i)</code\s*>`),
	}
)

// TextOf strips tags and collapses whitespace — the text a reader would see.
func TextOf(html string) string {
	s := tagRE.ReplaceAllString(html, " ")
	s = replaceEntitiesFold(s)
	return strings.Join(strings.Fields(s), " ")
}

// replaceEntitiesFold is the TypeScript's case-insensitive entity
// replacement, applied in the same order.
var entityOrder = []struct {
	re  *regexp.Regexp
	rep string
}{
	{regexp.MustCompile(`(?i)&nbsp;`), " "},
	{regexp.MustCompile(`(?i)&amp;`), "&"},
	{regexp.MustCompile(`(?i)&lt;`), "<"},
	{regexp.MustCompile(`(?i)&gt;`), ">"},
	{regexp.MustCompile(`(?i)&quot;`), `"`},
	{regexp.MustCompile(`(?i)&#39;`), "'"},
}

func replaceEntitiesFold(s string) string {
	for _, e := range entityOrder {
		s = e.re.ReplaceAllLiteralString(s, e.rep)
	}
	return s
}

type match struct {
	name               string
	start, innerStart  int
	innerEnd, matchEnd int
}

// pairs finds every <name ...>…</name> in order, the way the TypeScript's
// back-referencing regex does: lazily to the first matching close; an opener
// with no close is skipped and the scan moves on one character.
func pairs(src string, open *regexp.Regexp, closers map[string]*regexp.Regexp) []match {
	var out []match
	for pos := 0; pos < len(src); {
		loc := open.FindStringSubmatchIndex(src[pos:])
		if loc == nil {
			break
		}
		start, innerStart := pos+loc[0], pos+loc[1]
		name := strings.ToLower(src[pos+loc[2] : pos+loc[3]])
		c := closers[name].FindStringIndex(src[innerStart:])
		if c == nil {
			pos = start + 1
			continue
		}
		m := match{name: name, start: start, innerStart: innerStart, innerEnd: innerStart + c[0], matchEnd: innerStart + c[1]}
		out = append(out, m)
		pos = m.matchEnd
	}
	return out
}

// ChunkHTML returns the document's title and its chunks.
func ChunkHTML(src string) (string, []Chunk) {
	title := ""
	topic := "Overview"
	var chunks []Chunk
	seen := map[string]int{}

	type mark struct {
		level      int
		text       string
		start, end int
	}
	var marks []mark
	for _, m := range pairs(src, headingRE, closeH) {
		marks = append(marks, mark{level: int(m.name[1] - '0'), text: TextOf(src[m.innerStart:m.innerEnd]), start: m.start, end: m.matchEnd})
	}

	push := func(heading, bodyHTML string) {
		body := TextOf(bodyHTML)
		if body == "" && strings.TrimSpace(bodyHTML) == "" {
			return
		}
		n := seen[heading]
		seen[heading] = n + 1
		chunks = append(chunks, Chunk{
			Idx:          len(chunks),
			Topic:        topic,
			Heading:      heading,
			HeadingIndex: n,
			Summary:      firstSentences(body, 280),
			Keywords:     ExtractKeywords(bodyHTML),
			Body:         body,
			HTML:         strings.TrimSpace(bodyHTML),
		})
	}

	lead := src
	if len(marks) > 0 {
		lead = src[:marks[0].start]
	}
	if TextOf(lead) != "" {
		push("Overview", lead)
	}

	for i, mk := range marks {
		end := len(src)
		if i+1 < len(marks) {
			end = marks[i+1].start
		}
		bodyHTML := src[mk.end:end]
		if mk.level == 1 {
			// The <h1> is the document title, not a section.
			if title == "" {
				title = mk.text
			}
			if TextOf(bodyHTML) != "" {
				push("Overview", bodyHTML)
			}
			continue
		}
		if mk.level == 2 {
			topic = mk.text
		}
		push(mk.text, bodyHTML)
	}
	return title, chunks
}

// firstSentences cuts text to max code points, at a sentence end when one
// falls in the second half. Indexes count UTF-16 units past the cut, as the
// TypeScript does.
func firstSentences(text string, max int) string {
	r := []rune(text)
	if len(r) <= max {
		return text
	}
	cut := string(r[:max])
	units := utf16.Encode([]rune(cut))
	i := -1
	for k := len(units) - 1; k >= 0; k-- {
		if units[k] == '.' || units[k] == '!' || units[k] == '?' {
			i = k
			break
		}
	}
	if i > max/2 {
		return string(utf16.Decode(units[:i+1]))
	}
	return strings.TrimSpace(cut) + "…"
}

// ExtractKeywords is the section's <strong>/<code> terms: the lesson format
// bolds exactly the vocabulary that matters.
func ExtractKeywords(html string) string {
	seen := map[string]bool{}
	var out []string
	for _, m := range pairs(html, termRE, closeT) {
		t := TextOf(html[m.innerStart:m.innerEnd])
		lower := strings.ToLower(t)
		// Skip multi-line code blocks and duplicates.
		if t == "" || len(utf16.Encode([]rune(t))) > 60 || seen[lower] {
			continue
		}
		seen[lower] = true
		out = append(out, t)
		if len(out) == 15 {
			break
		}
	}
	return strings.Join(out, ", ")
}
