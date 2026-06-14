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
	"syscall"

	// Embed the timezone database so cron schedules resolve timezones on any base
	// image (no OS tzdata package required).
	_ "time/tzdata"

	"github.com/vorreix/profitsync-worker/internal/config"
	"github.com/vorreix/profitsync-worker/internal/httpapi"
	"github.com/vorreix/profitsync-worker/internal/jobs"
	"github.com/vorreix/profitsync-worker/internal/profitsync"
	"github.com/vorreix/profitsync-worker/internal/scheduler"
	"github.com/vorreix/profitsync-worker/internal/storage"
	"github.com/vorreix/profitsync-worker/internal/store"
	"github.com/vorreix/profitsync-worker/internal/worker"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "err", err)
		os.Exit(1)
	}

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

	ps := profitsync.New(cfg.ProfitSyncBaseURL, cfg.ProfitSyncServiceToken)
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

	go wkr.Run(ctx)
	go sch.Run(ctx)
	go func() {
		if err := srv.Run(ctx); err != nil {
			logger.Error("http server", "err", err)
			stop()
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
	logger.Info("shutdown signal received; draining")
	// worker.Run and srv.Run observe ctx and drain/stop themselves; give a brief
	// grace window for goroutines to finish before the process exits.
	stop()
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
