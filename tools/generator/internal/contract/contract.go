// Package contract enforces the lesson and quiz output contracts on what a
// model hands back: a port of the lesson/quiz half of
// lib/generate/validate.ts. Nothing reaches Supabase without passing here.
// Rules: docs/html-output-contract.md (lessons), docs/quiz-guidelines.md
// (quizzes). Keep the two implementations in step: testdata/parity.json is
// produced by the TypeScript checker (testdata/parity.mjs) and this package's
// tests replay it.
package contract

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var lessonTags = set("h1", "h2", "h3", "p", "ul", "ol", "li", "table", "thead", "tbody", "tr", "td", "th",
	"pre", "code", "blockquote", "strong", "em", "div", "figure", "img", "figcaption")

var quizTags = func() map[string]bool {
	m := map[string]bool{}
	for t := range lessonTags {
		if t != "h3" && t != "figure" && t != "img" && t != "figcaption" {
			m[t] = true
		}
	}
	return m
}()

var forbiddenH2 = set("Concept", "Exam Tips", "Remember", "Diagram", "Self Check")

var calloutLabels = []string{"Key Idea", "Common Mistake", "Exam Tip", "Remember"}

// MediaSrc is the one shape a stored picture's address takes
// (lib/vault/media-src.ts).
var MediaSrc = regexp.MustCompile(`^/api/media/([0-9a-f-]{36})/([0-9a-f]{64}\.(?:png|jpg|gif|webp))$`)

var (
	openTagRE    = regexp.MustCompile(`<([a-zA-Z0-9]+)(?:\s[^>]*)?>`)
	blockquoteRE = regexp.MustCompile(`(?s)<blockquote>(.*?)</blockquote>`)
	anyTagRE     = regexp.MustCompile(`<[^>]+>`)
	deepHeading  = regexp.MustCompile(`<h[4-6]>`)
	h2TextRE     = regexp.MustCompile(`<h2>([^<]*)</h2>`)
	figureRE     = regexp.MustCompile(`<figure>\s*<img\s[^>]*>\s*<figcaption>[^<]*(?:<(?:strong|em|code)>[^<]*</(?:strong|em|code)>[^<]*)*</figcaption>\s*</figure>`)
	imgRE        = regexp.MustCompile(`<img\s([^>]*)>`)
	srcRE        = regexp.MustCompile(`\bsrc="([^"]*)"`)
	altRE        = regexp.MustCompile(`\balt="([^"]*)"`)
	quizDeep     = regexp.MustCompile(`<h[3-6]>`)
	questionRE   = regexp.MustCompile(`<h2>\s*Q(\d+)\.[^<]*</h2>`)
	questionHead = regexp.MustCompile(`<h2>\s*(Q\d+\..*?)</h2>`)
	h1StartRE    = regexp.MustCompile(`<h1[\s>]`)
	titleRE      = regexp.MustCompile(`(?s)<h1[^>]*>(.*?)</h1>`)
)

func set(items ...string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, i := range items {
		m[i] = true
	}
	return m
}

// cut is the first n UTF-16 code units of s, as JavaScript's slice(0, n).
func cut(s string, n int) string {
	units := 0
	for i, r := range s {
		w := 1
		if r > 0xffff {
			w = 2
		}
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

func calloutText(html string) []string {
	var out []string
	for _, m := range blockquoteRE.FindAllStringSubmatch(html, -1) {
		out = append(out, strings.TrimSpace(anyTagRE.ReplaceAllString(m[1], "")))
	}
	return out
}

// disallowedTags reports opening tags outside the allowlist, each once, in
// first-seen order.
func disallowedTags(html string, allowed map[string]bool, contract string) []string {
	var errs []string
	seen := map[string]bool{}
	for _, m := range openTagRE.FindAllStringSubmatch(html, -1) {
		t := strings.ToLower(m[1])
		if !allowed[t] && !seen[t] {
			seen[t] = true
			errs = append(errs, fmt.Sprintf("disallowed tag <%s> — not in the %s allowlist", t, contract))
		}
	}
	return errs
}

func oneH1(html, what string) []string {
	n := strings.Count(html, "<h1>")
	if n == 1 {
		return nil
	}
	return []string{fmt.Sprintf("expected exactly one <h1> (%s title), found %d", what, n)}
}

// CheckLesson returns the lesson's contract violations. No slide pictures are
// offered to a generator run, so a picture may only be an app path to one
// already saved.
func CheckLesson(html string) []string {
	errs := disallowedTags(html, lessonTags, "html-output-contract")
	errs = append(errs, oneH1(html, "lesson")...)
	errs = append(errs, figureIssues(html)...)
	if deepHeading.MatchString(html) {
		errs = append(errs, "found a heading deeper than h3 — contract caps headings at h3")
	}
	for _, m := range h2TextRE.FindAllStringSubmatch(html, -1) {
		text := strings.TrimSpace(m[1])
		if forbiddenH2[text] {
			if text == "Concept" {
				errs = append(errs, `bare "Concept" heading with no name — must be "Concept: <Specific Name>"`)
			} else {
				errs = append(errs, fmt.Sprintf(`standalone "%s" heading — contract says never emit this heading`, text))
			}
		}
	}
	for _, text := range calloutText(html) {
		ok := false
		for _, l := range calloutLabels {
			if strings.HasPrefix(text, l+":") {
				ok = true
				break
			}
		}
		if !ok {
			errs = append(errs, fmt.Sprintf(`callout doesn't start with one of %s: "%s..."`, strings.Join(calloutLabels, ", "), cut(text, 60)))
		}
	}
	return errs
}

func figureIssues(html string) []string {
	var errs []string
	imgs := imgRE.FindAllStringSubmatch(html, -1)
	figures := len(figureRE.FindAllString(html, -1))
	if len(imgs) != figures || strings.Count(html, "<figure>") != figures {
		errs = append(errs, `every picture must be exactly <figure><img src="..." alt="..."><figcaption>...</figcaption></figure>, and a <figure> holds nothing else`)
	}
	for _, m := range imgs {
		src, alt := "", ""
		if s := srcRE.FindStringSubmatch(m[1]); s != nil {
			src = s[1]
		}
		if a := altRE.FindStringSubmatch(m[1]); a != nil {
			alt = a[1]
		}
		if !MediaSrc.MatchString(src) {
			errs = append(errs, fmt.Sprintf(`<img src="%s"> is not one of the slide pictures offered (none were offered)`, cut(src, 60)))
		}
		if strings.TrimSpace(alt) == "" {
			errs = append(errs, fmt.Sprintf(`<img src="%s"> has no alt text — say what the picture shows`, cut(src, 60)))
		}
	}
	return errs
}

// CheckQuiz returns the quiz's contract violations.
func CheckQuiz(html string) []string {
	errs := disallowedTags(html, quizTags, "quiz-guidelines")
	errs = append(errs, oneH1(html, "quiz")...)
	if quizDeep.MatchString(html) {
		errs = append(errs, "found h3+ — quiz scheme is flat, one <h2> per question only")
	}
	questions := questionRE.FindAllStringSubmatch(html, -1)
	if len(questions) != strings.Count(html, "<h2>") {
		errs = append(errs, `found an <h2> that isn't "Q<n>. ..." — every h2 must be a question heading`)
	}
	for i, m := range questions {
		if n, _ := strconv.Atoi(m[1]); n != i+1 {
			errs = append(errs, fmt.Sprintf("question numbering out of order: expected Q%d, found Q%s", i+1, m[1]))
		}
	}
	// Each question: its h2, then a Reasoning: and an Answer: callout, in order.
	for _, block := range splitBeforeH2(html) {
		if !strings.HasPrefix(block, "<h2>") {
			continue
		}
		label := "unknown question"
		if m := questionHead.FindStringSubmatch(block); m != nil {
			label = strings.TrimSpace(m[1])
		}
		callouts := calloutText(block)
		if len(callouts) != 2 {
			errs = append(errs, fmt.Sprintf(`"%s": expected exactly 2 callouts (Reasoning, Answer), found %d`, label, len(callouts)))
			continue
		}
		if !strings.HasPrefix(callouts[0], "Reasoning:") {
			errs = append(errs, fmt.Sprintf(`"%s": first callout must start with "Reasoning:"`, label))
		}
		if !strings.HasPrefix(callouts[1], "Answer:") {
			errs = append(errs, fmt.Sprintf(`"%s": second callout must start with "Answer:"`, label))
		}
	}
	return errs
}

// splitBeforeH2 is JavaScript's html.split(/(?=<h2>)/).
func splitBeforeH2(html string) []string {
	var out []string
	start := 0
	for i := 1; i < len(html); {
		j := strings.Index(html[i:], "<h2>")
		if j < 0 {
			break
		}
		at := i + j
		out = append(out, html[start:at])
		start = at
		i = at + 1
	}
	return append(out, html[start:])
}

// ExtractHTML is the document out of a model's reply: from the <h1> through
// the last closing tag. A model that wraps it in a code fence or a stray
// sentence shouldn't fail the run for that alone.
func ExtractHTML(reply string) (string, bool) {
	loc := h1StartRE.FindStringIndex(reply)
	if loc == nil {
		return "", false
	}
	tail := reply[loc[0]:]
	end := strings.LastIndex(tail, "</")
	if end < 0 {
		return "", false
	}
	closeAt := strings.Index(tail[end:], ">")
	if closeAt < 0 {
		return "", false
	}
	return strings.TrimSpace(tail[:end+closeAt+1]), true
}

// TitleOf is the plain text of the one <h1> — the title always comes from
// the content.
func TitleOf(html string) string {
	m := titleRE.FindStringSubmatch(html)
	if m == nil {
		return ""
	}
	inner := anyTagRE.ReplaceAllString(m[1], "")
	inner = strings.NewReplacer("&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&#39;", "'").Replace(inner)
	return strings.Join(strings.Fields(inner), " ")
}

var slugRE = regexp.MustCompile(`[^a-zA-Z0-9]+`)

// Slug is lib/vault/slug.ts's slugify, lowercased as /lect and /quiz always
// named documents, and capped so a key stays well inside a document id.
func Slug(title string) string {
	s := strings.Trim(slugRE.ReplaceAllString(strings.TrimSpace(title), "-"), "-")
	s = strings.ToLower(s)
	if len(s) > 120 {
		s = strings.TrimRight(s[:120], "-")
	}
	if s == "" {
		return "untitled"
	}
	return s
}
