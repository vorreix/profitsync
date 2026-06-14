# ============================================================================
# ProfitSync — Makefile
# React 19 + Vite + TypeScript · Vercel functions · Drizzle/Neon · Clerk
#
# Usage:  make            # show help
#         make <target>   # run a target
#
# NOTE: recipe lines must be TAB-indented (a GNU make requirement).
# ============================================================================

# Run every recipe in a single strict bash shell.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# ----------------------------------------------------------------------------
# Setup
# ----------------------------------------------------------------------------

.PHONY: install
install: ## Install npm dependencies
	@echo "→ installing dependencies..."
	@npm install

# ----------------------------------------------------------------------------
# Development
# ----------------------------------------------------------------------------

.PHONY: dev
dev: ## Start the dev server (Vite + API functions on :3000) via `vercel dev`
	@vercel dev

.PHONY: build
build: ## Type-check then bundle for production
	@echo "→ building..."
	@npm run build

.PHONY: preview
preview: ## Preview the production build locally
	@npm run preview

.PHONY: claude
claude: ## Run Claude Code with permission prompts skipped
	@claude --dangerously-skip-permissions

# ----------------------------------------------------------------------------
# Quality
# ----------------------------------------------------------------------------

.PHONY: typecheck
typecheck: ## Run the TypeScript type checker (no emit)
	@echo "→ type check..."
	@npm run typecheck

.PHONY: lint
lint: ## Lint the codebase (requires eslint — see the `pr` note below)
	@npx eslint .

.PHONY: format
format: ## Auto-fix lint/format issues (requires eslint)
	@npx eslint . --fix

# ----------------------------------------------------------------------------
# Database (Drizzle + Neon)
# ----------------------------------------------------------------------------

.PHONY: db-push
db-push: ## Push the Drizzle schema to Neon (needs .env.local)
	@echo "→ pushing schema to Neon..."
	@npm run db:push

# ----------------------------------------------------------------------------
# Pre-commit gate
#
# Run this before every commit / opening a PR. Kept in sync with the husky
# pre-commit hook (.husky/pre-commit). It fails fast on unresolved merge
# conflict markers (in ANY tracked or untracked file — code, docs or config),
# verifies i18n locale parity (every locale must carry all en.json keys), then
# runs eslint (autofix + check), the TypeScript type check, and the tests.
# ----------------------------------------------------------------------------

.PHONY: i18n
i18n: ## Verify every locale has all en.json keys (placeholders intact)
	@echo "→ i18n parity..."
	@npm run i18n:check

.PHONY: pr
pr: ## Full pre-commit gate: conflict markers → i18n parity → format → lint → type check → tests
	@echo "→ merge conflict markers..."
	@if git --no-pager grep --untracked -nE '^(<{7}|>{7}|\|{7})( |$$)' -- ':!*.sample'; then echo "✗ unresolved merge conflict markers found (above)" && exit 1; fi
	@echo "→ format..."
	@npx eslint . --fix || (echo "✗ format failed — unfixable lint errors" && exit 1)
	@echo "→ lint..."
	@npx eslint . || (echo "✗ lint failed" && exit 1)
	@echo "→ type check..."
	@npm run typecheck || (echo "✗ type check failed" && exit 1)
	@echo "→ i18n parity (all locales must match en.json)..."
	@npm run i18n:check || (echo "✗ i18n parity check failed — add the missing translations to every locale in src/lib/i18n/locales/" && exit 1)
	@echo "→ tests..."
	@npm run test:ci || (echo "✗ tests failed" && exit 1)
	@echo "✓ all checks passed"

# ----------------------------------------------------------------------------
# Background worker (worker/ — docker-compose, project: profitsync-worker)
# Delegates to worker/Makefile. Run `make -C worker help` for all worker targets.
# ----------------------------------------------------------------------------

.PHONY: worker-up
worker-up: ## Build + start the background worker (docker, project profitsync-worker)
	@$(MAKE) -C worker up

.PHONY: worker-down
worker-down: ## Stop + remove the worker containers (keeps volumes)
	@$(MAKE) -C worker down

.PHONY: worker-logs
worker-logs: ## Follow the worker's logs
	@$(MAKE) -C worker logs

.PHONY: worker-ps
worker-ps: ## Show the worker stack status
	@$(MAKE) -C worker ps

# ----------------------------------------------------------------------------
# Help
# ----------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
