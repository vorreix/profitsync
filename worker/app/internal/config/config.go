// Package config loads all runtime configuration from the environment.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config is the fully-resolved worker configuration.
type Config struct {
	// HTTP API
	Port      string
	APIToken  string // bearer token required by the enqueue/admin endpoints

	// The worker's OWN Postgres (job queue + schedules) — NOT the app DB.
	DatabaseURL string

	// Engine
	Concurrency       int           // number of parallel job workers
	PollInterval      time.Duration // how often to poll for ready jobs
	JobTimeout        time.Duration // hard cap per job execution
	MaxAttempts       int           // default retry attempts before a job is "dead"
	VisibilityTimeout time.Duration // a 'running' job idle this long is reaped (worker crashed)
	ShutdownGrace     time.Duration // max wait for in-flight jobs to drain on shutdown

	// Logging. Logs ALWAYS go to stdout (so `docker compose logs` works); when
	// LogDir is set they ALSO go to a size-rotated file under that dir (mount a
	// volume there to persist + rotate across restarts).
	LogLevel      string // debug | info | warn | error
	LogDir        string // empty = stdout only; e.g. /app/logs to also write a file
	LogMaxSizeMB  int    // rotate after a file reaches this size (MB)
	LogMaxBackups int    // how many rotated files to keep
	LogMaxAgeDays int    // delete rotated files older than this (days)
	LogCompress   bool   // gzip rotated files

	// ProfitSync app callback (for trigger-style jobs that run app logic).
	ProfitSyncBaseURL      string
	ProfitSyncServiceToken string

	// S3 / S3-compatible object storage (Hetzner, MinIO, AWS, …) for generated
	// files (PDF quotations, CSV exports). Optional — storage jobs no-op if unset.
	S3Endpoint  string
	S3Region    string
	S3Bucket    string
	S3AccessKey string
	S3SecretKey string
	S3UseSSL    bool
	S3PublicURL string // optional CDN/base URL used to build returned file URLs
}

// Load reads the environment and returns a validated Config (or an error listing
// what's missing). Only DATABASE_URL and WORKER_API_TOKEN are strictly required;
// the rest enable specific job families.
func Load() (Config, error) {
	c := Config{
		Port:                   env("PORT", "8080"),
		APIToken:               os.Getenv("WORKER_API_TOKEN"),
		DatabaseURL:            os.Getenv("DATABASE_URL"),
		Concurrency:            envInt("WORKER_CONCURRENCY", 5),
		PollInterval:           envDuration("WORKER_POLL_INTERVAL", 2*time.Second),
		JobTimeout:             envDuration("WORKER_JOB_TIMEOUT", 5*time.Minute),
		MaxAttempts:            envInt("WORKER_MAX_ATTEMPTS", 5),
		VisibilityTimeout:      envDuration("WORKER_VISIBILITY_TIMEOUT", 10*time.Minute),
		ShutdownGrace:          envDuration("WORKER_SHUTDOWN_GRACE", 30*time.Second),
		LogLevel:               env("WORKER_LOG_LEVEL", "info"),
		LogDir:                 os.Getenv("WORKER_LOG_DIR"),
		LogMaxSizeMB:           envInt("WORKER_LOG_MAX_SIZE_MB", 50),
		LogMaxBackups:          envInt("WORKER_LOG_MAX_BACKUPS", 10),
		LogMaxAgeDays:          envInt("WORKER_LOG_MAX_AGE_DAYS", 30),
		LogCompress:            envBool("WORKER_LOG_COMPRESS", true),
		ProfitSyncBaseURL:      os.Getenv("PROFITSYNC_BASE_URL"),
		ProfitSyncServiceToken: os.Getenv("PROFITSYNC_SERVICE_TOKEN"),
		S3Endpoint:             os.Getenv("S3_ENDPOINT"),
		S3Region:               env("S3_REGION", "us-east-1"),
		S3Bucket:               os.Getenv("S3_BUCKET"),
		S3AccessKey:            os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:            os.Getenv("S3_SECRET_KEY"),
		S3UseSSL:               envBool("S3_USE_SSL", true),
		S3PublicURL:            os.Getenv("S3_PUBLIC_URL"),
	}

	if c.DatabaseURL == "" {
		return c, fmt.Errorf("DATABASE_URL is required")
	}
	if c.APIToken == "" {
		return c, fmt.Errorf("WORKER_API_TOKEN is required")
	}
	if c.Concurrency < 1 {
		c.Concurrency = 1
	}
	return c, nil
}

// S3Configured reports whether object storage is usable.
func (c Config) S3Configured() bool {
	return c.S3Endpoint != "" && c.S3Bucket != "" && c.S3AccessKey != "" && c.S3SecretKey != ""
}

// ProfitSyncConfigured reports whether app callbacks are usable.
func (c Config) ProfitSyncConfigured() bool {
	return c.ProfitSyncBaseURL != "" && c.ProfitSyncServiceToken != ""
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		if b, err := strconv.ParseBool(v); err == nil {
			return b
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
