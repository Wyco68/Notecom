package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OpenAI and OpenRouter: the same Chat Completions API at two fixed hosts.

var openAIBase = map[Service]string{
	OpenAI:     "https://api.openai.com/v1",
	OpenRouter: "https://openrouter.ai/api/v1",
}

// One client for every call: no overall timeout (a long reply streams for
// many minutes; the job's context cancels it), but a bounded wait for the
// response headers.
var httpClient = &http.Client{
	Transport: &http.Transport{
		Proxy:                 nil,
		ResponseHeaderTimeout: 10 * time.Minute,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ForceAttemptHTTP2:     true,
	},
}

func openAIContent(p Part) map[string]any {
	switch p.Kind {
	case PDFPart:
		return map[string]any{"type": "file", "file": map[string]any{"filename": p.Name, "file_data": "data:application/pdf;base64," + p.Data}}
	case ImagePart:
		return map[string]any{"type": "image_url", "image_url": map[string]any{"url": "data:" + p.Mime + ";base64," + p.Data}}
	}
	return map[string]any{"type": "text", "text": p.Text}
}

func chatOpenAICompatible(ctx context.Context, req Request) (*Result, error) {
	messages := []any{map[string]any{"role": "system", "content": req.System}}
	for _, t := range req.Turns {
		if t.Role == "assistant" {
			var b strings.Builder
			for _, p := range t.Parts {
				if p.Kind == TextPart {
					b.WriteString(p.Text)
				}
			}
			messages = append(messages, map[string]any{"role": "assistant", "content": b.String()})
			continue
		}
		content := make([]any, 0, len(t.Parts))
		for _, p := range t.Parts {
			content = append(content, openAIContent(p))
		}
		messages = append(messages, map[string]any{"role": "user", "content": content})
	}
	body, err := json.Marshal(map[string]any{
		"model":          req.Model,
		"stream":         true,
		"stream_options": map[string]any{"include_usage": true},
		"messages":       messages,
	})
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, openAIBase[req.Service]+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+req.Key)
	httpReq.Header.Set("Content-Type", "application/json")
	if req.Service == OpenRouter {
		// OpenRouter's app attribution; only sent there.
		httpReq.Header.Set("X-Title", "Notecom")
	}
	res, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, network(err, req.Key)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, httpFailure(res, req.Key, false)
	}

	var (
		text      strings.Builder
		finish    string
		out       Result
		streamErr string
	)
	err = readSSE(res.Body, func(data string) error {
		if data == "[DONE]" {
			return nil
		}
		var chunk struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Usage *struct {
				PromptTokens     int64 `json:"prompt_tokens"`
				CompletionTokens int64 `json:"completion_tokens"`
			} `json:"usage"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			return nil
		}
		// OpenRouter reports an upstream failure inside the stream.
		if chunk.Error != nil {
			streamErr = CleanMessage(chunk.Error.Message, req.Key)
			if streamErr == "" {
				streamErr = "the service reported an error"
			}
		}
		if len(chunk.Choices) > 0 {
			c := chunk.Choices[0]
			if c.Delta.Content != "" {
				text.WriteString(c.Delta.Content)
				if req.OnProgress != nil {
					req.OnProgress(text.String())
				}
			}
			if c.FinishReason != nil && *c.FinishReason != "" {
				finish = *c.FinishReason
			}
		}
		if chunk.Usage != nil {
			out.Input = chunk.Usage.PromptTokens
			out.Output = chunk.Usage.CompletionTokens
		}
		return nil
	})
	if err != nil {
		return nil, network(err, req.Key)
	}
	if streamErr != "" {
		return nil, fail(KindOther, streamErr)
	}
	if finish == "content_filter" {
		return nil, fail(KindRefused, "The model declined to write this one.")
	}
	out.Text = text.String()
	out.Truncated = finish == "length"
	return &out, nil
}

// httpFailure reads a provider's error body. Gemini answers a bad key with
// 400 INVALID_ARGUMENT, not 401, and says so in the details.
func httpFailure(res *http.Response, key string, gemini bool) error {
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))
	var body struct {
		Error struct {
			Message string `json:"message"`
			Details []struct {
				Reason string `json:"reason"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.Unmarshal(raw, &body)
	msg := body.Error.Message
	if msg == "" {
		msg = http.StatusText(res.StatusCode)
	}
	msg = CleanMessage(msg, key)
	if msg == "" {
		msg = fmt.Sprintf("HTTP %d", res.StatusCode)
	}
	kind := KindForStatus(res.StatusCode)
	if gemini {
		for _, d := range body.Error.Details {
			if d.Reason == "API_KEY_INVALID" {
				kind = KindAuth
			}
		}
	}
	return fail(kind, msg)
}
