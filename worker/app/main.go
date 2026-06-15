// Command worker is the ProfitSync background-processing service: a durable
// Postgres-backed job queue + cron scheduler + HTTP control API. It runs on a
// separate host (see deploy/docker-compose.yml) and is isolated from the app DB —
// it talks to ProfitSync over an authenticated internal API and stores generated
// files in S3-compatible object storage.
package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"

	// Embed the timezone database so cron schedules resolve timezones on any base
	// image (no OS tzdata package required).
	_ "time/tzdata"

	"github.com/vorreix/profitsync-worker/internal/config"
	"github.com/vorreix/profitsync-worker/internal/httpapi"
	"github.com/vorreix/profitsync-worker/internal/jobs"
	"github.com/vorreix/profitsync-worker/internal/logging"
	"github.com/vorreix/profitsync-worker/internal/profitsync"
	"github.com/vorreix/profitsync-worker/internal/scheduler"
	"github.com/vorreix/profitsync-worker/internal/storage"
	"github.com/vorreix/profitsync-worker/internal/store"
	"github.com/vorreix/profitsync-worker/internal/worker"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	// Structured logger: JSON to stdout, plus a rotating file when WORKER_LOG_DIR
	// is set (see internal/logging).
	logger, logCloser := logging.New(cfg)
	if logCloser != nil {
		defer logCloser.Close()
	}
	logger.Info("logging configured", "level", cfg.LogLevel, "to_file", cfg.LogDir != "", "dir", cfg.LogDir)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("connect worker db", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	mig, err := readMigrations()
	if err != nil {
		logger.Error("read migrations", "err", err)
		os.Exit(1)
	}
	if err := st.Migrate(ctx, mig); err != nil {
		logger.Error("migrate", "err", err)
		os.Exit(1)
	}

	ps := profitsync.New(cfg.ProfitSyncBaseURL, cfg.ProfitSyncServiceToken, logger)
	var s3 *storage.Client
	if cfg.S3Configured() {
		if s3, err = storage.New(cfg); err != nil {
			logger.Warn("object storage init failed; storage jobs disabled", "err", err)
			s3 = nil
		}
	}

	reg := jobs.NewRegistry()
	jobs.RegisterAll(reg, jobs.Deps{ProfitSync: ps, Storage: s3, Logger: logger})

	hostname, _ := os.Hostname()
	wkr := worker.New(st, reg, cfg, logger, fmt.Sprintf("%s-%d", hostname, os.Getpid()))
	sch := scheduler.New(st, cfg, logger)
	srv := httpapi.New(st, cfg, logger)

	// Run the three loops, tracked so shutdown can WAIT for them to drain.
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); wkr.Run(ctx) }()
	go func() { defer wg.Done(); sch.Run(ctx) }()
	go func() {
		defer wg.Done()
		if err := srv.Run(ctx); err != nil {
			logger.Error("http server", "err", err)
			stop() // a fatal HTTP error triggers a full shutdown
		}
	}()

	logger.Info("profitsync worker started",
		"port", cfg.Port,
		"concurrency", cfg.Concurrency,
		"job_types", reg.Types(),
		"s3", cfg.S3Configured(),
		"profitsync", cfg.ProfitSyncConfigured(),
	)

	<-ctx.Done()
	logger.Info("shutdown signal received; draining in-flight jobs", "grace", cfg.ShutdownGrace.String())

	// Wait for the worker pool (and the HTTP server + scheduler) to finish, but
	// don't hang forever if a job is stuck — bound by the shutdown grace.
	drained := make(chan struct{})
	go func() { wg.Wait(); close(drained) }()
	select {
	case <-drained:
		logger.Info("clean shutdown — all in-flight jobs drained")
	case <-time.After(cfg.ShutdownGrace):
		logger.Warn("shutdown grace exceeded; exiting with jobs still in flight (they will be reaped)")
	}
}

// readMigrations concatenates the embedded *.sql files in lexical order.
func readMigrations() (string, error) {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return "", err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	var out []byte
	for _, n := range names {
		b, err := migrationsFS.ReadFile("migrations/" + n)
		if err != nil {
			return "", err
		}
		out = append(out, b...)
		out = append(out, '\n')
	}
	return string(out), nil
}
