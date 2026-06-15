// Package profitsync is a thin authenticated client for calling back into the
// ProfitSync app's internal API. Trigger-style jobs (e.g. "run due notifications",
// "generate monthly analysis") use this so the business logic + DB access stay in
// the app — the worker only provides the clock, the queue, and retries.
package profitsync

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Client calls ProfitSync internal endpoints with a shared service token.
type Client struct {
	baseURL string
	token   string
	http    *http.Client
	log     *slog.Logger
}

// New returns a client. If baseURL/token are empty the client is considered
// unconfigured and Call returns an error (callers should check Configured()).
func New(baseURL, token string, log *slog.Logger) *Client {
	if log == nil {
		log = slog.Default()
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 30 * time.Second},
		log:     log,
	}
}

// Configured reports whether the client can make calls.
func (c *Client) Configured() bool { return c.baseURL != "" && c.token != "" }

// Call performs an authenticated request to `path` (e.g. "/api/internal/cron").
// A non-2xx response is returned as an error including the response body.
func (c *Client) Call(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("profitsync client not configured")
	}
	if method == "" {
		method = http.MethodPost
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	var rdr io.Reader
	if len(body) > 0 {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	start := time.Now()
	resp, err := c.http.Do(req)
	if err != nil {
		c.log.Error("profitsync callback failed", "method", method, "path", path, "err", err, "dur_ms", time.Since(start).Milliseconds())
		return nil, err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	durMs := time.Since(start).Milliseconds()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		c.log.Error("profitsync callback non-2xx", "method", method, "path", path, "status", resp.StatusCode, "dur_ms", durMs, "body", truncate(string(out), 300))
		return nil, fmt.Errorf("profitsync %s %s -> %d: %s", method, path, resp.StatusCode, string(out))
	}
	c.log.Info("profitsync callback ok", "method", method, "path", path, "status", resp.StatusCode, "dur_ms", durMs)
	return out, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
