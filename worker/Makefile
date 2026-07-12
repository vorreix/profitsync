# ============================================================================
# ProfitSync Worker — Makefile
# Self-hosted Go job queue + cron scheduler + S3 service (docker-compose).
#
# Usage:  make            # show help
#         make up         # build + start the worker stack (project: profitsync-worker)
#
# Runs every target through docker compose with project name `profitsync-worker`
# against deploy/docker-compose.yml. Recipe lines must be TAB-indented.
# ============================================================================

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

WORKER_PROJECT := profitsync-worker
DEPLOY_DIR     := deploy
# `-p` pins the Compose project name (also set via `name:` in the compose file).
COMPOSE        := docker compose -p $(WORKER_PROJECT)

# Run a compose command from the deploy dir so .env + relative paths resolve.
define compose
	@cd $(DEPLOY_DIR) && $(COMPOSE) $(1)
endef

# ----------------------------------------------------------------------------
# Lifecycle
# ----------------------------------------------------------------------------

.PHONY: up
up: env ## Build (if needed) + start the worker stack, detached (+ registers the notification schedule)
	@echo "→ starting $(WORKER_PROJECT)..."
	$(call compose, up -d --build)
	@echo "✓ up — \`make logs\` to follow, \`make health\` to check"
	@$(MAKE) --no-print-directory register

.PHONY: start
start: ## Start the stack without rebuilding
	$(call compose, up -d)

.PHONY: stop
stop: ## Stop the containers (keep them + volumes)
	$(call compose, stop)

.PHONY: down
down: ## Stop + remove the containers (KEEPS the volumes: queue DB + logs)
	$(call compose, down)

.PHONY: restart
restart: ## Restart just the worker service
	$(call compose, restart worker)

.PHONY: rebuild
rebuild: ## Rebuild the image + recreate the containers (+ registers the notification schedule)
	$(call compose, up -d --build --force-recreate)
	@$(MAKE) --no-print-directory register

.PHONY: up-proxy
up-proxy: env ## Start the stack WITH the Caddy HTTPS proxy (prod; needs WORKER_DOMAIN + DNS + ports 80/443)
	@echo "→ starting $(WORKER_PROJECT) + Caddy TLS proxy..."
	$(call compose, --profile proxy up -d --build)
	@echo "✓ up — Caddy is fronting https://$$(grep -E '^WORKER_DOMAIN=' $(DEPLOY_DIR)/.env | cut -d= -f2 || echo worker.profitsync.net)"
	@$(MAKE) --no-print-directory register

.PHONY: proxy-logs
proxy-logs: ## Follow the Caddy reverse-proxy logs (cert issuance, requests)
	$(call compose, --profile proxy logs -f caddy)

.PHONY: nuke
nuke: ## Stop + remove containers AND volumes (DESTROYS the queue DB + logs)
	$(call compose, down -v)

# ----------------------------------------------------------------------------
# Observability
# ----------------------------------------------------------------------------

.PHONY: ps
ps: ## Show the stack status
	$(call compose, ps)

.PHONY: logs
logs: ## Follow the worker's stdout logs (Ctrl-C to stop)
	$(call compose, logs -f worker)

.PHONY: logs-file
logs-file: ## Tail the rotating log file inside the container (/app/logs/worker.log)
	$(call compose, exec worker tail -f /app/logs/worker.log)

.PHONY: health
health: ## Hit the worker's health check (inside the container)
	$(call compose, exec worker wget -qO- http://127.0.0.1:8080/healthz)
	@echo

.PHONY: stats
stats: ## Print queue stats (requires WORKER_API_TOKEN in deploy/.env)
	@cd $(DEPLOY_DIR) && set -a && . ./.env && set +a && \
		$(COMPOSE) exec worker wget -qO- --header "Authorization: Bearer $$WORKER_API_TOKEN" http://127.0.0.1:8080/v1/stats
	@echo

# ----------------------------------------------------------------------------
# Maintenance
# ----------------------------------------------------------------------------

.PHONY: shell
shell: ## Open a shell in the running worker container
	$(call compose, exec worker sh)

.PHONY: psql
psql: ## Open psql on the worker's own queue database
	$(call compose, exec postgres psql -U worker -d worker)

.PHONY: register
register: ## Register the notification cron schedule on the worker (retries while it boots)
	@cd $(DEPLOY_DIR) && set -a && . ./.env && set +a && \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -fsS -X POST "http://localhost:$${WORKER_PORT:-8080}/v1/schedules" \
			-H "Authorization: Bearer $$WORKER_API_TOKEN" -H 'Content-Type: application/json' \
			-d '{"name":"notifications-dispatch","type":"app.trigger","cron":"0 * * * *","timezone":"UTC","payload":{"path":"/api/cron/notifications"}}' \
			>/dev/null 2>&1; then \
			echo "  ✓ notifications-dispatch registered (hourly reconcile sweep for scheduled broadcasts)"; exit 0; \
		fi; \
		echo "  … worker not ready yet (attempt $$i/10), retrying in 3s"; sleep 3; \
	done; \
	echo "  ✗ FAILED to register the notification schedule — reminders/broadcasts will NOT fire from this worker."; \
	echo "    Retry with 'make register' or use /admin → Worker → 'Register notification schedule'."; \
	exit 1

.PHONY: env
env: ## Verify deploy/.env exists (copy from .env.example if missing)
	@if [ ! -f $(DEPLOY_DIR)/.env ]; then \
		echo "✗ $(DEPLOY_DIR)/.env not found — create it:  cp $(DEPLOY_DIR)/.env.example $(DEPLOY_DIR)/.env  then fill in the secrets"; \
		exit 1; \
	fi

# ----------------------------------------------------------------------------
# Help
# ----------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@echo "ProfitSync worker (compose project: $(WORKER_PROJECT))"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
