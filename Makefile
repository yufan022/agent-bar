# agent-bar — Electron menu bar app + agent-bridge CLI
#
# Usage: make <target>

.PHONY: help install dev build test cli dist typecheck clean clean-all

.DEFAULT_GOAL := help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

dev: ## Run the Electron menu bar app
	pnpm dev

build: ## Typecheck, bundle the Node entrypoints, and build the renderer
	pnpm build

dist: ## Package the macOS app
	pnpm dist

test: ## Run unit tests
	pnpm test

typecheck: ## Typecheck renderer and Node sources
	pnpm typecheck

cli: ## Build agent-bridge and agent-bar CLIs
	node scripts/build-node.mjs

clean: ## Remove build output
	rm -rf dist dist-electron release

clean-all: clean ## Also remove node_modules
	rm -rf node_modules
