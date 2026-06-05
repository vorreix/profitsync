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
# Run this before every commit / opening a PR. It fails fast on unresolved merge
# conflict markers (in ANY tracked or untracked file — code, docs or config),
# then runs eslint (autofix + check), the TypeScript type check, and the tests.
# ----------------------------------------------------------------------------

.PHONY: pr
pr: ## Full pre-commit gate: conflict markers → format → lint → type check → tests
	@echo "→ merge conflict markers..."
	@if git --no-pager grep --untracked -nE '^(<{7}|>{7}|\|{7})( |$$)' -- ':!*.sample'; then echo "✗ unresolved merge conflict markers found (above)" && exit 1; fi
	@echo "→ format..."
	@npx eslint . --fix || (echo "✗ format failed — unfixable lint errors" && exit 1)
	@echo "→ lint..."
	@npx eslint . || (echo "✗ lint failed" && exit 1)
	@echo "→ type check..."
	@npm run typecheck || (echo "✗ type check failed" && exit 1)
	@echo "→ tests..."
	@npm run test:ci || (echo "✗ tests failed" && exit 1)
	@echo "✓ all checks passed"

# ----------------------------------------------------------------------------
# Help
# ----------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
