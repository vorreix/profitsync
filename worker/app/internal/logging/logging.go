// Package logging configures the worker's structured logger. Logs are written as
// JSON to stdout (so `docker compose logs` works), and — when WORKER_LOG_DIR is
// set — ALSO to a size-rotated file under that directory (lumberjack), kept across
// restarts when the dir is a mounted volume.
package logging

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/natefinch/lumberjack.v2"

	"github.com/vorreix/profitsync-worker/internal/config"
)

// New builds the application logger from config. When a log dir is configured the
// returned logger fans out to stdout AND a rotating file; otherwise stdout only.
// The second return value, if non-nil, is the file rotator to Close() on shutdown.
func New(cfg config.Config) (*slog.Logger, io.Closer) {
	level := parseLevel(cfg.LogLevel)
	opts := &slog.HandlerOptions{Level: level}

	if cfg.LogDir == "" {
		return slog.New(slog.NewJSONHandler(os.Stdout, opts)), nil
	}

	// Best-effort: if the dir can't be created we fall back to stdout-only rather
	// than crash the worker over logging.
	if err := os.MkdirAll(cfg.LogDir, 0o755); err != nil {
		l := slog.New(slog.NewJSONHandler(os.Stdout, opts))
		l.Warn("log dir not writable; logging to stdout only", "dir", cfg.LogDir, "err", err)
		return l, nil
	}

	rot := &lumberjack.Logger{
		Filename:   filepath.Join(cfg.LogDir, "worker.log"),
		MaxSize:    max(1, cfg.LogMaxSizeMB),
		MaxBackups: cfg.LogMaxBackups,
		MaxAge:     cfg.LogMaxAgeDays,
		Compress:   cfg.LogCompress,
	}
	w := io.MultiWriter(os.Stdout, rot)
	return slog.New(slog.NewJSONHandler(w, opts)), rot
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
