// Package source turns an upload into what a web service can read: a port of
// lib/ai/source.ts. PDFs and pictures go as they are (every supported
// service reads both); Markdown and text as text; a slide deck or Word file
// as its text, pulled out of the zip here — no service reads .pptx or .docx.
// Bounded throughout, so a broken or hostile file fails fast.
package source

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"notecom/generator/internal/ai"
)

// Error is a failure written for the reader.
type Error struct{ Msg string }

func (e *Error) Error() string { return e.Msg }

func fail(msg string) error { return &Error{Msg: msg} }

const (
	MaxBytes        = 20 * 1024 * 1024
	maxTextChars    = 400_000
	maxSlides       = 600
	maxEntries      = 2000
	maxXMLBytes     = 8 * 1024 * 1024
	maxArchiveBytes = 100 * 1024 * 1024
)

var (
	textName = regexp.MustCompile(`(?i)\.(md|markdown|txt)$`)
	images   = map[string]string{"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}
	slideRE  = regexp.MustCompile(`^ppt/slides/slide(\d+)\.xml$`)
)

// Parts reads one upload named name.
func Parts(name string, data []byte) ([]ai.Part, error) {
	if len(data) > MaxBytes {
		return nil, fail(fmt.Sprintf("That file is over %d MB. Export a smaller PDF.", MaxBytes/(1024*1024)))
	}
	ext := ""
	if i := strings.LastIndex(name, "."); i >= 0 {
		ext = strings.ToLower(name[i+1:])
	}

	if ext == "pdf" {
		if !bytes.HasPrefix(data, []byte("%PDF-")) {
			return nil, fail("That file isn't a readable PDF.")
		}
		return []ai.Part{{Kind: ai.PDFPart, Data: base64.StdEncoding.EncodeToString(data), Name: name}}, nil
	}

	if mime, ok := images[ext]; ok {
		return []ai.Part{{Kind: ai.ImagePart, Data: base64.StdEncoding.EncodeToString(data), Mime: mime}}, nil
	}

	if textName.MatchString(name) {
		text := strings.TrimSpace(strings.ToValidUTF8(string(data), "\uFFFD"))
		if text == "" {
			return nil, fail("That file is empty.")
		}
		if err := tooLong(utf8.RuneCountInString(text)); err != nil {
			return nil, err
		}
		return []ai.Part{ai.Text(fmt.Sprintf("Source file %q:\n\n%s", name, text))}, nil
	}

	if ext == "pptx" || ext == "docx" {
		sections, err := officeText(ext, data)
		if err != nil {
			var se *Error
			if errors.As(err, &se) {
				return nil, err
			}
			return nil, fail("That file couldn't be opened. Save it again, or export it as PDF.")
		}
		var kept []string
		for i, lines := range sections {
			body := strings.Join(lines, "\n")
			if strings.TrimSpace(body) == "" {
				continue
			}
			if ext == "pptx" {
				body = fmt.Sprintf("## Slide %d\n", i+1) + body
			}
			kept = append(kept, body)
		}
		body := strings.Join(kept, "\n\n")
		if strings.TrimSpace(body) == "" {
			return nil, fail("No text could be read from that file. Export it as PDF and upload that instead.")
		}
		if err := tooLong(utf8.RuneCountInString(body)); err != nil {
			return nil, err
		}
		return []ai.Part{ai.Text(fmt.Sprintf("Source file %q, converted to text (pictures are not included):\n\n%s", name, body))}, nil
	}

	return nil, fail("Upload a PDF, slide deck (.pptx), Word file (.docx), picture or Markdown file.")
}

func tooLong(chars int) error {
	if chars > maxTextChars {
		return fail("That file has too much text for one lesson. Split it.")
	}
	return nil
}

func officeText(ext string, data []byte) ([][]string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	if len(zr.File) > maxEntries {
		return nil, errors.New("too many entries")
	}
	files := make(map[string]*zip.File, len(zr.File))
	for _, f := range zr.File {
		files[f.Name] = f
	}
	budget := int64(maxArchiveBytes)
	read := func(f *zip.File) (string, error) {
		limit := int64(maxXMLBytes)
		if budget < limit {
			limit = budget
		}
		rc, err := f.Open()
		if err != nil {
			return "", err
		}
		defer rc.Close()
		b, err := io.ReadAll(io.LimitReader(rc, limit+1))
		if err != nil {
			return "", err
		}
		if int64(len(b)) > limit {
			if limit == maxXMLBytes {
				return "", fail("That file is too large to read. Export it as PDF instead.")
			}
			return "", errors.New("archive too large")
		}
		budget -= int64(len(b))
		return string(b), nil
	}

	if ext == "docx" {
		f := files["word/document.xml"]
		if f == nil {
			return [][]string{nil}, nil
		}
		xml, err := read(f)
		if err != nil {
			return nil, err
		}
		return [][]string{paragraphs(xml, "w")}, nil
	}

	type slide struct {
		n int
		f *zip.File
	}
	var slides []slide
	for name, f := range files {
		if m := slideRE.FindStringSubmatch(name); m != nil {
			n, _ := strconv.Atoi(m[1])
			slides = append(slides, slide{n, f})
		}
	}
	sort.Slice(slides, func(i, j int) bool { return slides[i].n < slides[j].n })
	if len(slides) > maxSlides {
		return nil, fail("That deck has too many slides for one lesson. Split it.")
	}
	out := make([][]string, 0, len(slides))
	total := 0
	for _, s := range slides {
		xml, err := read(s.f)
		if err != nil {
			return nil, err
		}
		lines := paragraphs(xml, "a")
		for _, l := range lines {
			total += utf8.RuneCountInString(l) + 1
		}
		if err := tooLong(total); err != nil {
			return nil, err
		}
		out = append(out, lines)
	}
	return out, nil
}

var tokenRE = map[string]*regexp.Regexp{
	"a": regexp.MustCompile(`<a:t(?:\s[^<>]*)?>([^<]*)</a:t>|</a:p>`),
	"w": regexp.MustCompile(`<w:t(?:\s[^<>]*)?>([^<]*)</w:t>|</w:p>`),
}

// paragraphs is every paragraph's text, one line each, in one linear pass.
func paragraphs(xml, ns string) []string {
	var lines []string
	var line strings.Builder
	for _, m := range tokenRE[ns].FindAllStringSubmatchIndex(xml, -1) {
		if m[2] >= 0 {
			line.WriteString(decode(xml[m[2]:m[3]]))
			continue
		}
		if t := strings.TrimSpace(line.String()); t != "" {
			lines = append(lines, t)
		}
		line.Reset()
	}
	if t := strings.TrimSpace(line.String()); t != "" {
		lines = append(lines, t)
	}
	return lines
}

var (
	hexEntity = regexp.MustCompile(`(?i)&#x([0-9a-f]+);`)
	decEntity = regexp.MustCompile(`&#(\d+);`)
)

func codePoint(s string, base int) string {
	n, err := strconv.ParseInt(s, base, 32)
	if err != nil || n < 0 || n > 0x10ffff {
		return ""
	}
	return string(rune(n))
}

func decode(s string) string {
	s = hexEntity.ReplaceAllStringFunc(s, func(m string) string { return codePoint(m[3:len(m)-1], 16) })
	s = decEntity.ReplaceAllStringFunc(s, func(m string) string { return codePoint(m[2:len(m)-1], 10) })
	return strings.NewReplacer("&lt;", "<", "&gt;", ">", "&quot;", `"`, "&apos;", "'", "&amp;", "&").Replace(s)
}
