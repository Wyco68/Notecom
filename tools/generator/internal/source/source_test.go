package source

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	"notecom/generator/internal/ai"
)

func office(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func slide(lines ...string) string {
	var b strings.Builder
	b.WriteString(`<p:sld><p:txBody>`)
	for _, l := range lines {
		b.WriteString(`<a:p><a:r><a:t xml:space="preserve">` + l + `</a:t></a:r></a:p>`)
	}
	b.WriteString(`</p:txBody></p:sld>`)
	return b.String()
}

func TestSlidesInNumberOrderWithEntities(t *testing.T) {
	deck := office(t, map[string]string{
		"ppt/slides/slide10.xml": slide("Ten"),
		"ppt/slides/slide2.xml":  slide("Two &amp; &lt;b&gt;", "&#x41;&#66;"),
		"ppt/slides/slide1.xml":  slide("One"),
		"ppt/slides/slide3.xml":  slide("   "),
		"ppt/media/image1.png":   "png",
	})
	parts, err := Parts("deck.pptx", deck)
	if err != nil {
		t.Fatal(err)
	}
	got := parts[0].Text
	want := "## Slide 1\nOne\n\n## Slide 2\nTwo & <b>\nAB\n\n## Slide 4\nTen"
	if !strings.HasSuffix(got, want) || !strings.HasPrefix(got, `Source file "deck.pptx", converted to text`) {
		t.Fatalf("got %q", got)
	}
}

func TestWordDocument(t *testing.T) {
	doc := office(t, map[string]string{"word/document.xml": `<w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body>`})
	parts, err := Parts("notes.docx", doc)
	if err != nil || !strings.HasSuffix(parts[0].Text, "\n\nHello world\nSecond") {
		t.Fatalf("%v %+v", err, parts)
	}
}

func TestFilesAsTheyAre(t *testing.T) {
	p, err := Parts("a.PDF", []byte("%PDF-1.4 x"))
	if err != nil || p[0].Kind != ai.PDFPart || p[0].Name != "a.PDF" {
		t.Fatalf("pdf: %v %+v", err, p)
	}
	p, err = Parts("pic.jpeg", []byte{0xff, 0xd8})
	if err != nil || p[0].Kind != ai.ImagePart || p[0].Mime != "image/jpeg" {
		t.Fatalf("image: %v %+v", err, p)
	}
	p, err = Parts("n.md", []byte("  # Title  \n"))
	if err != nil || p[0].Text != "Source file \"n.md\":\n\n# Title" {
		t.Fatalf("markdown: %v %+v", err, p)
	}
}

func TestRefusals(t *testing.T) {
	cases := map[string][]byte{
		"fake.pdf":    []byte("not a pdf"),
		"empty.txt":   []byte("   "),
		"x.exe":       []byte("MZ"),
		"broken.pptx": []byte("PK not really"),
		"blank.pptx":  office(t, map[string]string{"ppt/slides/slide1.xml": slide()}),
		"big.pdf":     append([]byte("%PDF-"), make([]byte, MaxBytes)...),
	}
	for name, data := range cases {
		var se *Error
		if _, err := Parts(name, data); !errors.As(err, &se) {
			t.Errorf("%s: want a reader-facing error, got %v", name, err)
		}
	}
}

func TestInflationIsBounded(t *testing.T) {
	huge := strings.Repeat("a", maxXMLBytes+10)
	deck := office(t, map[string]string{"ppt/slides/slide1.xml": huge})
	_, err := Parts("bomb.pptx", deck)
	var se *Error
	if !errors.As(err, &se) || !strings.Contains(se.Msg, "too large") {
		t.Fatalf("got %v", err)
	}
}
