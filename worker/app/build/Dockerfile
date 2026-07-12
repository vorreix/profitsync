# Multi-stage build for the ProfitSync worker.
# Build context is the `app/` directory (see deploy/docker-compose.yml).

# Go 1.25: the maroto v2 PDF library's (transitive, test-only) dep graph needs
# a >=1.25 toolchain to resolve. go.sum IS committed, so the build is fully
# reproducible — we `go build` straight from the lockfile (no `go mod tidy`,
# which would re-resolve/upgrade and reintroduce non-determinism).
FROM golang:1.25-alpine AS build
WORKDIR /src

# Toolchain for module resolution.
RUN apk add --no-cache git

COPY . .

ENV CGO_ENABLED=0 GOOS=linux
RUN go build -trimpath -ldflags="-s -w" -o /out/worker .

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/worker /app/worker
# Log dir (WORKER_LOG_DIR=/app/logs). Owned by the unprivileged user so a mounted
# volume inherits that ownership and the worker can write rotated log files.
RUN mkdir -p /app/logs && chown -R app:app /app
USER app

EXPOSE 8080
# Liveness: the service exposes GET /healthz.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/app/worker"]
