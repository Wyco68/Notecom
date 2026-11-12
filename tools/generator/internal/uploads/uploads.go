// Package uploads reads a job's upload from the private notes-job-uploads
// bucket. The generator has no storage credential: when the app files a
// VPS job it signs each upload's URL as the reader (storage RLS decides) and
// the job carries the token. The URL is rebuilt here from the configured
// project URL and the upload's own path — never taken from the job row — so
// the token can only ever fetch the reader's own file from Supabase.
package uploads

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const bucket = "notes-job-uploads"

// MaxBytes matches the bucket's file size limit.
const MaxBytes = 20 * 1024 * 1024

var (
	pathRE  = regexp.MustCompile(`^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$`)
	tokenRE = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
)

// Upload is one entry of a job's params.uploads.
type Upload struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Token string `json:"token"`
}

// Gone is what the reader is told when the file can't be read.
type Gone struct{ Name string }

func (g *Gone) Error() string { return fmt.Sprintf("the upload %q is gone — start again", g.Name) }

// OwnPath reports whether path is one file in owner's own folder.
func OwnPath(owner, path string) bool {
	return strings.HasPrefix(path, owner+"/") && pathRE.MatchString(path)
}

// ValidToken reports whether token looks like a signed-URL token.
func ValidToken(token string) bool { return len(token) <= 4096 && tokenRE.MatchString(token) }

type Reader struct {
	base   string // https://<ref>.supabase.co
	client *http.Client
}

func NewReader(supabaseURL string) (*Reader, error) {
	return NewReaderWithClient(supabaseURL, &http.Client{Timeout: 2 * time.Minute})
}

// NewReaderWithClient is NewReader with its own HTTP client (tests).
func NewReaderWithClient(supabaseURL string, client *http.Client) (*Reader, error) {
	u, err := url.Parse(strings.TrimRight(supabaseURL, "/"))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Path != "" {
		return nil, errors.New("SUPABASE_URL must be the project's https origin")
	}
	return &Reader{base: u.String(), client: client}, nil
}

// Read downloads owner's upload u.
func (r *Reader) Read(ctx context.Context, owner string, u Upload) ([]byte, error) {
	if !OwnPath(owner, u.Path) || !ValidToken(u.Token) {
		return nil, &Gone{Name: u.Name}
	}
	endpoint := r.base + "/storage/v1/object/sign/" + bucket + "/" + u.Path + "?token=" + url.QueryEscape(u.Token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	res, err := r.client.Do(req)
	if err != nil {
		// Never log the URL: its token reads the reader's file for hours.
		var uerr *url.Error
		if errors.As(err, &uerr) {
			err = uerr.Err
		}
		return nil, fmt.Errorf("reading upload %q: %v", u.Name, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		// Expired, removed, or never the reader's: the same answer.
		return nil, &Gone{Name: u.Name}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, MaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxBytes {
		return nil, fmt.Errorf("upload %q is over the bucket limit", u.Name)
	}
	return data, nil
}
