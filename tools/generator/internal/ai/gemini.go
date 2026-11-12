package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// Google Gemini through its REST API, streamed as server-sent events.

const geminiBase = "https://generativelanguage.googleapis.com/v1beta"

func geminiPart(p Part) map[string]any {
	switch p.Kind {
	case PDFPart:
		return map[string]any{"inline_data": map[string]any{"mime_type": "application/pdf", "data": p.Data}}
	case ImagePart:
		return map[string]any{"inline_data": map[string]any{"mime_type": p.Mime, "data": p.Data}}
	}
	return map[string]any{"text": p.Text}
}

func chatGemini(ctx context.Context, req Request) (*Result, error) {
	model := strings.TrimPrefix(req.Model, "models/")
	contents := make([]any, 0, len(req.Turns))
	for _, t := range req.Turns {
		role := "user"
		if t.Role == "assistant" {
			role = "model"
		}
		parts := make([]any, 0, len(t.Parts))
		for _, p := range t.Parts {
			parts = append(parts, geminiPart(p))
		}
		contents = append(contents, map[string]any{"role": role, "parts": parts})
	}
	body, err := json.Marshal(map[string]any{
		"systemInstruction": map[string]any{"parts": []any{map[string]any{"text": req.System}}},
		"contents":          contents,
	})
	if err != nil {
		return nil, err
	}
	endpoint := geminiBase + "/models/" + url.PathEscape(model) + ":streamGenerateContent?alt=sse"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("x-goog-api-key", req.Key)
	httpReq.Header.Set("Content-Type", "application/json")
	res, err := httpClient.Do(httpReq)
	if err != nil {
		return nil, network(err, req.Key)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, httpFailure(res, req.Key, true)
	}

	var (
		text    strings.Builder
		finish  string
		blocked bool
		out     Result
	)
	err = readSSE(res.Body, func(data string) error {
		var chunk struct {
			PromptFeedback *struct {
				BlockReason string `json:"blockReason"`
			} `json:"promptFeedback"`
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text    *string `json:"text"`
						Thought bool    `json:"thought"`
					} `json:"parts"`
				} `json:"content"`
				FinishReason string `json:"finishReason"`
			} `json:"candidates"`
			UsageMetadata *struct {
				PromptTokenCount     int64 `json:"promptTokenCount"`
				CandidatesTokenCount int64 `json:"candidatesTokenCount"`
				ThoughtsTokenCount   int64 `json:"thoughtsTokenCount"`
			} `json:"usageMetadata"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			return nil
		}
		if chunk.PromptFeedback != nil && chunk.PromptFeedback.BlockReason != "" {
			blocked = true
		}
		if len(chunk.Candidates) > 0 {
			c := chunk.Candidates[0]
			for _, p := range c.Content.Parts {
				// A thinking model's reasoning parts are not the reply.
				if p.Text != nil && !p.Thought {
					text.WriteString(*p.Text)
					if req.OnProgress != nil {
						req.OnProgress(text.String())
					}
				}
			}
			if c.FinishReason != "" {
				finish = c.FinishReason
			}
		}
		if u := chunk.UsageMetadata; u != nil {
			out.Input = u.PromptTokenCount
			out.Output = u.CandidatesTokenCount + u.ThoughtsTokenCount
		}
		return nil
	})
	if err != nil {
		return nil, network(err, req.Key)
	}
	if blocked || finish == "SAFETY" || finish == "PROHIBITED_CONTENT" || finish == "RECITATION" {
		return nil, fail(KindRefused, "The model declined to write this one.")
	}
	out.Text = text.String()
	out.Truncated = finish == "MAX_TOKENS"
	return &out, nil
}
