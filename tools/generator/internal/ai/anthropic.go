package ai

import (
	"context"
	"errors"
	"regexp"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

// Claude through the Anthropic API, via the official SDK, streamed: a lesson
// is a long reply. Opus-tier models get server-side refusal fallbacks, so a
// request their classifiers decline is re-run on Anthropic's recommended
// fallback model instead of coming back empty.

// Set explicitly, and environment defaults are off: nothing in the server's
// environment may redirect a reader's key elsewhere.
const anthropicAPI = "https://api.anthropic.com"

// Models that accept `fallbacks: "default"`.
var fallbackModels = map[string]bool{
	"claude-fable-5-1":  true,
	"claude-opus-5-5":   true,
	"claude-opus-5":     true,
	"claude-sonnet-5-5": true,
}

// Models that take output_config.effort.
var effortRE = regexp.MustCompile(`^claude-(?:(?:fable|opus|sonnet|haiku|mythos)-5|opus-4-[5-8]|sonnet-4-6)`)

// Models with at least 64K output tokens.
var longOutputRE = regexp.MustCompile(`^claude-(?:(?:fable|opus|sonnet|haiku|mythos)-5|opus-4-[5-8]|sonnet-4-[56]|haiku-4-5)`)

func anthropicBlocks(parts []Part) []anthropic.BetaContentBlockParamUnion {
	out := make([]anthropic.BetaContentBlockParamUnion, 0, len(parts))
	for _, p := range parts {
		switch p.Kind {
		case PDFPart:
			out = append(out, anthropic.NewBetaDocumentBlock(anthropic.BetaBase64PDFSourceParam{Data: p.Data}))
		case ImagePart:
			out = append(out, anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
				Data:      p.Data,
				MediaType: anthropic.BetaBase64ImageSourceMediaType(p.Mime),
			}))
		default:
			out = append(out, anthropic.NewBetaTextBlock(p.Text))
		}
	}
	return out
}

func chatAnthropic(ctx context.Context, req Request) (*Result, error) {
	client := anthropic.NewClient(
		option.WithoutEnvironmentDefaults(),
		option.WithAPIKey(req.Key),
		option.WithBaseURL(anthropicAPI),
		option.WithMaxRetries(2),
	)

	msgs := make([]anthropic.BetaMessageParam, 0, len(req.Turns))
	for _, t := range req.Turns {
		blocks := anthropicBlocks(t.Parts)
		if t.Role == "assistant" {
			msgs = append(msgs, anthropic.BetaMessageParam{OfAssistant: &anthropic.BetaAssistantMessageParam{Content: blocks}})
		} else {
			msgs = append(msgs, anthropic.NewBetaUserMessage(blocks...))
		}
	}

	maxTokens := int64(8192)
	if longOutputRE.MatchString(req.Model) {
		maxTokens = 64000
	}
	params := anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(req.Model),
		MaxTokens: maxTokens,
		System:    []anthropic.BetaTextBlockParam{{Text: req.System}},
		Messages:  msgs,
	}
	if effortRE.MatchString(req.Model) {
		params.OutputConfig = anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortHigh}
	}
	if fallbackModels[req.Model] {
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
		params.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
	}

	stream := client.Beta.Messages.NewStreaming(ctx, params)
	defer stream.Close()
	var (
		message anthropic.BetaMessage
		sofar   []byte
	)
	for stream.Next() {
		event := stream.Current()
		if err := message.Accumulate(event); err != nil {
			return nil, fail(KindOther, CleanMessage(err.Error(), req.Key))
		}
		if d, ok := event.AsAny().(anthropic.BetaRawContentBlockDeltaEvent); ok {
			if t, ok := d.Delta.AsAny().(anthropic.BetaTextDelta); ok && t.Text != "" {
				sofar = append(sofar, t.Text...)
				if req.OnProgress != nil {
					req.OnProgress(string(sofar))
				}
			}
		}
	}
	if err := stream.Err(); err != nil {
		return nil, anthropicError(err, req.Key)
	}

	if message.StopReason == anthropic.BetaStopReasonRefusal {
		return nil, fail(KindRefused, "The model declined to write this one.")
	}
	var text []byte
	for _, b := range message.Content {
		if t, ok := b.AsAny().(anthropic.BetaTextBlock); ok {
			text = append(text, t.Text...)
		}
	}
	u := message.Usage
	return &Result{
		Text:      string(text),
		Truncated: message.StopReason == anthropic.BetaStopReasonMaxTokens,
		Input:     u.InputTokens + u.CacheReadInputTokens + u.CacheCreationInputTokens,
		Output:    u.OutputTokens,
	}, nil
}

func anthropicError(err error, key string) error {
	var apierr *anthropic.Error
	if errors.As(err, &apierr) {
		kind := KindForStatus(apierr.StatusCode)
		if apierr.StatusCode == 404 {
			kind = KindBadRequest
		}
		return fail(kind, CleanMessage(apierr.Error(), key))
	}
	return network(err, key)
}
