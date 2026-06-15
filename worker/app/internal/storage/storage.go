// Package storage wraps an S3-compatible object store (Hetzner Object Storage,
// MinIO, AWS S3, …) for generated artifacts (PDF quotations, CSV exports). The
// app persists only the returned URL; the bytes live in object storage.
package storage

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/vorreix/profitsync-worker/internal/config"
)

// Client is a minimal object-storage wrapper.
type Client struct {
	mc        *minio.Client
	bucket    string
	publicURL string
}

// New builds a client from config. Caller should only call this when
// cfg.S3Configured() is true.
func New(cfg config.Config) (*Client, error) {
	endpoint := strings.TrimPrefix(strings.TrimPrefix(cfg.S3Endpoint, "https://"), "http://")
	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.S3AccessKey, cfg.S3SecretKey, ""),
		Secure: cfg.S3UseSSL,
		Region: cfg.S3Region,
	})
	if err != nil {
		return nil, fmt.Errorf("minio: %w", err)
	}
	return &Client{mc: mc, bucket: cfg.S3Bucket, publicURL: strings.TrimRight(cfg.S3PublicURL, "/")}, nil
}

// Put uploads an object and returns a URL for it. If a public base URL is
// configured it builds a direct URL; otherwise it returns a presigned GET URL
// valid for `presign`.
func (c *Client) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string, presign time.Duration) (string, error) {
	_, err := c.mc.PutObject(ctx, c.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		return "", fmt.Errorf("put object: %w", err)
	}
	if c.publicURL != "" {
		return c.publicURL + "/" + strings.TrimLeft(key, "/"), nil
	}
	return c.PresignedGet(ctx, key, presign)
}

// PresignedGet returns a time-limited download URL for an object.
func (c *Client) PresignedGet(ctx context.Context, key string, expiry time.Duration) (string, error) {
	if expiry <= 0 {
		expiry = 7 * 24 * time.Hour
	}
	u, err := c.mc.PresignedGetObject(ctx, c.bucket, key, expiry, url.Values{})
	if err != nil {
		return "", fmt.Errorf("presign: %w", err)
	}
	return u.String(), nil
}
