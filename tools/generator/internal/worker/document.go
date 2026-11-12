package worker

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"notecom/generator/internal/ai"
	"notecom/generator/internal/contract"
	"notecom/generator/internal/search"
	"notecom/generator/internal/store"
)

// A lesson or quiz from one upload: write → contract check → up to two fix
// rounds → save. One AI call per step (lib/jobs/kinds/document.ts).

const (
	maxFixes    = 2
	minPartial  = 1000
	continueAsk = "Your reply above was interrupted before it finished. Continue it from exactly where it stops: " +
		"no repeat of what is already written, no preamble, nothing before the next character."
)

func (r *run) documentStep() error {
	kind, noun, docKind := "lect", "lesson", "lesson"
	if r.job.Kind == "quiz" {
		kind, noun, docKind = "quiz", "quiz", "quiz"
	}
	folder := r.params.Folder

	// Saved in the same transaction that recorded the result: a worker that
	// died after the save finds it here instead of writing it twice.
	if r.result != nil {
		r.done(r.result, fmt.Sprintf("Saved %s %q to %s.", noun, r.result.Title, folder))
		return nil
	}

	r.mu.Lock()
	if !r.state.Started {
		r.state.Started = true
		r.log = append(r.log, fmt.Sprintf("Writing the %s…", noun))
	}
	r.mu.Unlock()

	system, err := r.w.Prompts.System(kind)
	if err != nil {
		return err
	}
	out, err := r.converse(system,
		func() ([]ai.Part, error) {
			src, err := r.source()
			if err != nil {
				return nil, err
			}
			return append(append([]ai.Part(nil), src...),
				ai.Text(fmt.Sprintf("Write the %s from this source. Reply with only its complete HTML, starting at the <h1>.", noun))), nil
		},
		func(reply string) (string, []string) {
			html, ok := contract.ExtractHTML(reply)
			if !ok {
				return "", []string{fmt.Sprintf("no %s came back — reply with the complete HTML, starting at the <h1>", noun)}
			}
			var problems []string
			if kind == "quiz" {
				problems = contract.CheckQuiz(html)
			} else {
				problems = contract.CheckLesson(html)
			}
			return html, problems
		},
		func(problems []string) string {
			if len(problems) > 10 {
				problems = problems[:10]
			}
			short := make([]string, len(problems))
			for i, p := range problems {
				short[i] = cutRunes(p, 200)
			}
			return fmt.Sprintf("The app rejected that %s against its output contract: %s. "+
				"Fix exactly these problems without changing anything else, and reply with only the complete corrected HTML, starting at the <h1>.",
				noun, strings.Join(short, "; "))
		},
	)
	if err != nil {
		return err
	}

	switch out.kind {
	case "retry":
		r.say(fmt.Sprintf("Contract check failed — asking %s to fix it (%d of %d).", r.label, out.round, maxFixes))
		return nil
	case "cut":
		r.fail("The reply hit the model's output limit and was cut off. Nothing was saved. Try a model with a larger output limit.")
		return nil
	case "exhausted":
		p := out.problems
		if len(p) > 5 {
			p = p[:5]
		}
		r.fail(fmt.Sprintf("Still failing the contract check after two fixes: %s. Nothing was saved.", strings.Join(p, "; ")))
		return nil
	}

	r.say(fmt.Sprintf("The %s passed the contract check — saving it.", noun))
	if err := r.save("", false); err != nil {
		return err
	}
	saved, err := r.saveDocument(docKind, out.value)
	if err != nil {
		return err
	}
	r.done(saved, fmt.Sprintf("Saved %s %q to %s.", noun, saved.Title, folder))
	return nil
}

type conversed struct {
	kind     string // accepted, retry, exhausted, cut
	value    string
	problems []string
	round    int
}

// converse is one round of ask → check → fix (lib/jobs/converse.ts). Between
// calls only the last reply and the fix request are kept on the job; a reply
// cut short by the worker stopping is kept as it streams and continued by
// the next worker instead of started again.
func (r *run) converse(system string, first func() ([]ai.Part, error), check func(string) (string, []string), fix func([]string) string) (conversed, error) {
	r.mu.Lock()
	var c conv
	if r.state.Write != nil {
		c = *r.state.Write
	}
	r.mu.Unlock()

	parts, err := first()
	if err != nil {
		return conversed{}, err
	}
	turns := []ai.Turn{{Role: "user", Parts: parts}}
	if c.Reply != "" && c.Fix != "" {
		turns = append(turns,
			ai.Turn{Role: "assistant", Parts: []ai.Part{ai.Text(c.Reply)}},
			ai.Turn{Role: "user", Parts: []ai.Part{ai.Text(c.Fix)}})
	}
	// Too short to be worth continuing: asked again from the start.
	partial := ""
	if utf8.RuneCountInString(c.Partial) >= minPartial {
		partial = c.Partial
		turns = append(turns,
			ai.Turn{Role: "assistant", Parts: []ai.Part{ai.Text(partial)}},
			ai.Turn{Role: "user", Parts: []ai.Part{ai.Text(continueAsk)}})
	}

	res, err := r.ask(system, turns, func(sofar string) {
		// Called with r.mu held.
		w := c
		w.Partial = sofar
		if partial != "" {
			w.Partial = joinContinuation(partial, sofar)
		}
		r.state.Write = &w
	})
	if err != nil {
		return conversed{}, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if res.Truncated {
		r.state.Write = nil
		return conversed{kind: "cut"}, nil
	}
	reply := res.Text
	if partial != "" {
		reply = joinContinuation(partial, res.Text)
	}
	html, problems := check(reply)
	if len(problems) == 0 {
		r.state.Write = nil
		return conversed{kind: "accepted", value: html}, nil
	}
	if c.Round >= maxFixes {
		r.state.Write = nil
		return conversed{kind: "exhausted", problems: problems}, nil
	}
	r.state.Write = &conv{Round: c.Round + 1, Reply: reply, Fix: fix(problems)}
	return conversed{kind: "retry", round: c.Round + 1}, nil
}

// joinContinuation is the interrupted reply and its continuation as one; a
// model that restarts a line or repeats the last few words is joined at the
// overlap.
var fenceStart = regexp.MustCompile("(?i)^\\s*```[a-z]*\n")

func joinContinuation(partial, more string) string {
	next := fenceStart.ReplaceAllString(more, "")
	n := min(400, len(partial), len(next))
	for ; n >= 12; n-- {
		if strings.HasPrefix(next, partial[len(partial)-n:]) {
			return partial + next[n:]
		}
	}
	return partial + next
}

// saveDocument names and numbers the document from what the folder already
// holds (lib/generate/save.ts) and saves it with its search chunks.
func (r *run) saveDocument(docKind, html string) (*store.Result, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	title := contract.TitleOf(html)
	if title == "" {
		title = "Untitled"
	}
	title = cutRunes(title, 300)
	slug := contract.Slug(title)

	docs, err := r.w.Store.Docs(ctx, r.job, docKind)
	if err != nil {
		return nil, err
	}
	seq := 0
	taken := map[string]bool{}
	for _, d := range docs {
		taken[d.Key] = true
		if !d.Deleted && d.Seq > seq {
			seq = d.Seq
		}
	}
	seq++

	_, chunks := search.ChunkHTML(html)
	if chunks == nil {
		chunks = []search.Chunk{}
	}
	base := fmt.Sprintf("%02d-%s", seq, slug)
	for n := 1; n <= 50; n++ {
		key := base
		if n > 1 {
			key = fmt.Sprintf("%s-%d", base, n)
		}
		if taken[key] {
			continue
		}
		res, err := r.w.Store.SaveDoc(ctx, r.job, docKind, key, slug, title, seq, html, chunks)
		if err != nil {
			return nil, err
		}
		if res != nil {
			return res, nil
		}
		taken[key] = true
	}
	return nil, &failure{msg: "no free name for this document in the folder"}
}

func cutRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
