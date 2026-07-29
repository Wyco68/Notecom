package main

import (
	"strings"

	"golang.org/x/net/html"
)

type chunk struct {
	Topic    string
	Heading  string
	Summary  string
	Keywords string
	Text     string
	HTML     string
}

// chunkHTML splits a lesson document into educational sections: every <h2>
// opens a topic, every <h3> opens a chunk inside it, content before the
// first heading lands in an "Overview" chunk. Fixed token windows would cut
// explanations mid-thought; heading boundaries are how the lessons are
// actually taught (see docs/architecture.md).
func chunkHTML(src string) (title string, chunks []chunk) {
	doc, err := html.Parse(strings.NewReader(src))
	if err != nil {
		return "", nil
	}
	body := findBody(doc)
	if body == nil {
		return "", nil
	}

	topic := "Overview"
	var cur *chunk
	flush := func() {
		if cur != nil && (strings.TrimSpace(cur.Text) != "" || cur.HTML != "") {
			finishChunk(cur)
			chunks = append(chunks, *cur)
		}
		cur = nil
	}
	open := func(heading string) {
		flush()
		cur = &chunk{Topic: topic, Heading: heading}
	}

	for n := body.FirstChild; n != nil; n = n.NextSibling {
		if n.Type != html.ElementNode {
			continue
		}
		switch n.Data {
		case "h1":
			title = textOf(n)
		case "h2":
			topic = textOf(n)
			open(topic)
		case "h3":
			open(textOf(n))
		default:
			if cur == nil {
				open("Overview")
			}
			cur.HTML += renderNode(n)
			cur.Text += textOf(n) + "\n"
		}
	}
	flush()
	return title, chunks
}

func finishChunk(c *chunk) {
	c.Text = strings.TrimSpace(c.Text)
	c.Summary = firstSentences(c.Text, 280)
	c.Keywords = extractKeywords(c.HTML)
}

func findBody(n *html.Node) *html.Node {
	if n.Type == html.ElementNode && n.Data == "body" {
		return n
	}
	for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
		if b := findBody(ch); b != nil {
			return b
		}
	}
	return nil
}

func textOf(n *html.Node) string {
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.TextNode {
			sb.WriteString(n.Data)
			sb.WriteString(" ")
		}
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			walk(ch)
		}
	}
	walk(n)
	return strings.Join(strings.Fields(sb.String()), " ")
}

func renderNode(n *html.Node) string {
	var sb strings.Builder
	_ = html.Render(&sb, n)
	return sb.String()
}

func firstSentences(text string, max int) string {
	r := []rune(text)
	if len(r) <= max {
		return text
	}
	cut := string(r[:max])
	if i := strings.LastIndexAny(cut, ".!?"); i > max/2 {
		return cut[:i+1]
	}
	return strings.TrimSpace(cut) + "…"
}

// extractKeywords collects the distinct <strong>/<code> terms of a chunk —
// the lesson format bolds exactly the exam-relevant vocabulary, which makes
// them free, high-precision keywords.
func extractKeywords(chunkHTML string) string {
	doc, err := html.Parse(strings.NewReader(chunkHTML))
	if err != nil {
		return ""
	}
	seen := map[string]bool{}
	var out []string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && (n.Data == "strong" || n.Data == "code") {
			t := textOf(n)
			lt := strings.ToLower(t)
			// skip multi-line code blocks and dupes
			if t != "" && len(t) <= 60 && !seen[lt] {
				seen[lt] = true
				out = append(out, t)
			}
			return
		}
		for ch := n.FirstChild; ch != nil; ch = ch.NextSibling {
			walk(ch)
		}
	}
	walk(doc)
	if len(out) > 15 {
		out = out[:15]
	}
	return strings.Join(out, ", ")
}
