# Multi-stage build for the ProfitSync worker.
# Build context is the `app/` directory (see deploy/docker-compose.yml).

FROM golang:1.23-alpine AS build
WORKDIR /src

# Toolchain for module resolution.
RUN apk add --no-cache git

# Copy the source. (No go.sum is committed for the scaffold, so we resolve the
# module graph at build time; commit go.sum for fully reproducible builds.)
COPY . .

ENV CGO_ENABLED=0 GOOS=linux GOFLAGS=-mod=mod
RUN go mod tidy && \
    go build -trimpath -ldflags="-s -w" -o /out/worker .

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
