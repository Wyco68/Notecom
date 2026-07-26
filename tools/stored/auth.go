package main

// Supabase user authentication for the sync worker.
//
// stored used to authenticate with the service-role key, which bypasses RLS
// entirely. That was safe while the vault was single-user; it is not safe now
// that folders are shared, because a service key would pull every user's rows
// onto this machine. So stored signs in as an ordinary user and sends that
// user's access token: the database decides what this device may read and
// write, exactly as it does for the web app.
//
// Credentials come from <data-dir>/sync.env (or the environment):
//
//	SUPABASE_URL            https://<ref>.supabase.co
//	SUPABASE_ANON_KEY       publishable key — safe on disk, useless without a token
//	SUPABASE_REFRESH_TOKEN  preferred; written back here after the first sign-in
//	SUPABASE_EMAIL/_PASSWORD  used once to bootstrap, then removed from the file
//
// The password is deliberately transient: it is exchanged for a refresh token
// on first use and erased, so a long-lived password never sits on disk.

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type tokenSet struct {
	accessToken  string
	refreshToken string
	expiresAt    time.Time
	userID       string
}

type authenticator struct {
	baseURL string
	anonKey string
	envPath string // sync.env, rewritten when the refresh token rotates
	http    *http.Client

	mu  sync.Mutex
	tok tokenSet
}

type grantResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	User         struct {
		ID string `json:"id"`
	} `json:"user"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
	Message          string `json:"message"`
	// GoTrue reports failures as {"error_code":"...","msg":"..."}; without
	// these two the only thing left to print is the bare HTTP status, which
	// turns "wrong password" and "email not confirmed" into the same
	// unactionable "400 Bad Request".
	ErrorCode string `json:"error_code"`
	Msg       string `json:"msg"`
}

// reason picks the most specific failure text the response carries.
func (g grantResponse) reason(status string) string {
	for _, s := range []string{g.ErrorDescription, g.Msg, g.Message, g.Error, g.ErrorCode} {
		if s != "" {
			return s
		}
	}
	return status
}

func newAuthenticator(envPath string) *authenticator {
	return &authenticator{
		baseURL: strings.TrimSuffix(os.Getenv("SUPABASE_URL"), "/"),
		anonKey: os.Getenv("SUPABASE_ANON_KEY"),
		envPath: envPath,
		http:    &http.Client{Timeout: 30 * time.Second},
		tok: tokenSet{
			refreshToken: os.Getenv("SUPABASE_REFRESH_TOKEN"),
		},
	}
}

// configured reports whether sync has enough to attempt a sign-in. A missing
// credential is a normal state (fully-local install), not an error.
func (a *authenticator) configured() bool {
	if a.baseURL == "" || a.anonKey == "" {
		return false
	}
	return a.tok.refreshToken != "" ||
		(os.Getenv("SUPABASE_EMAIL") != "" && os.Getenv("SUPABASE_PASSWORD") != "")
}

// missing names the first credential piece that is absent, for the log line a
// user reads when sync did not start. An empty value counts as absent — a
// `SUPABASE_PASSWORD=` line with nothing after the `=` is the trap this
// message exists to call out.
func (a *authenticator) missing() string {
	switch {
	case a.baseURL == "":
		return "SUPABASE_URL is not set"
	case a.anonKey == "":
		return "SUPABASE_ANON_KEY is not set"
	case a.tok.refreshToken != "":
		return ""
	case os.Getenv("SUPABASE_EMAIL") == "":
		return "no SUPABASE_REFRESH_TOKEN, and SUPABASE_EMAIL is empty"
	case os.Getenv("SUPABASE_PASSWORD") == "":
		return "no SUPABASE_REFRESH_TOKEN, and SUPABASE_PASSWORD is empty " +
			"(it is needed once, then exchanged for a refresh token and erased)"
	}
	return ""
}

// token returns a valid access token, refreshing or signing in as needed. The
// 60s skew keeps a token from expiring mid-request.
func (a *authenticator) token() (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.tok.accessToken != "" && time.Now().Add(60*time.Second).Before(a.tok.expiresAt) {
		return a.tok.accessToken, nil
	}
	if a.tok.refreshToken != "" {
		if err := a.grant("refresh_token", map[string]string{"refresh_token": a.tok.refreshToken}); err == nil {
			return a.tok.accessToken, nil
		} else {
			// A rejected refresh token is terminal for this token — fall through
			// to the password path if one is still configured.
			log.Printf("sync: refresh failed: %v", err)
			a.tok.refreshToken = ""
		}
	}
	email, password := os.Getenv("SUPABASE_EMAIL"), os.Getenv("SUPABASE_PASSWORD")
	if email == "" || password == "" {
		return "", fmt.Errorf("no usable Supabase credential (set SUPABASE_REFRESH_TOKEN or SUPABASE_EMAIL/SUPABASE_PASSWORD in %s)", a.envPath)
	}
	if err := a.grant("password", map[string]string{"email": email, "password": password}); err != nil {
		return "", err
	}
	return a.tok.accessToken, nil
}

// invalidate forces the next token() call to refresh. Called on a 401 so a
// token revoked server-side doesn't wedge the worker until restart.
func (a *authenticator) invalidate() {
	a.mu.Lock()
	a.tok.accessToken = ""
	a.mu.Unlock()
}

func (a *authenticator) currentUser() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.tok.userID
}

func (a *authenticator) grant(grantType string, body map[string]string) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost,
		a.baseURL+"/auth/v1/token?grant_type="+grantType, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("apikey", a.anonKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := a.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	var g grantResponse
	if err := json.NewDecoder(res.Body).Decode(&g); err != nil {
		return fmt.Errorf("auth %s: %s", grantType, res.Status)
	}
	if res.StatusCode >= 300 || g.AccessToken == "" {
		return fmt.Errorf("auth %s: %s", grantType, g.reason(res.Status))
	}

	a.tok = tokenSet{
		accessToken:  g.AccessToken,
		refreshToken: g.RefreshToken,
		expiresAt:    time.Now().Add(time.Duration(g.ExpiresIn) * time.Second),
		userID:       g.User.ID,
	}
	a.persistRefreshToken()
	return nil
}

// persistRefreshToken writes the rotated token back to sync.env and drops the
// password once it is no longer needed. Best-effort: a read-only config file
// costs a re-sign-in next start, not a sync failure.
func (a *authenticator) persistRefreshToken() {
	if a.envPath == "" || a.tok.refreshToken == "" {
		return
	}
	existing, err := os.ReadFile(a.envPath)
	if err != nil {
		return
	}
	var out []string
	for _, line := range strings.Split(string(existing), "\n") {
		trimmed := strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(trimmed, "SUPABASE_REFRESH_TOKEN="),
			strings.HasPrefix(trimmed, "SUPABASE_PASSWORD="):
			continue
		case trimmed == "" && len(out) > 0 && out[len(out)-1] == "":
			continue
		}
		out = append(out, strings.TrimRight(line, "\r"))
	}
	out = append(out, "SUPABASE_REFRESH_TOKEN="+a.tok.refreshToken)

	if err := os.WriteFile(a.envPath, []byte(strings.Join(out, "\n")+"\n"), 0o600); err != nil {
		log.Printf("sync: could not persist refresh token: %v", err)
		return
	}
	os.Unsetenv("SUPABASE_PASSWORD")
}
