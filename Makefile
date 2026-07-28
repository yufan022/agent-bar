# agent-bar — Tauri menu bar app + agent-bridge CLI
#
# Usage: make <target>

CARGO_MANIFEST := src-tauri/Cargo.toml
CLI_PACKAGES   := -p agent-bridge -p agent-bar-cli
CORE_PACKAGE   := -p agent-bridge-core

.PHONY: help install dev build test cli install-cli clean clean-all check

.DEFAULT_GOAL := help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

install: ## Install npm dependencies
	npm install

dev: ## Run Tauri app in development mode
	npm run tauri dev

build: ## Build and bundle the Tauri app (release)
	npm run tauri build

test: ## Run agent-bridge-core unit tests
	cargo test $(CORE_PACKAGE) --manifest-path $(CARGO_MANIFEST)

cli: ## Build agent-bridge and agent-bar CLI (release)
	cargo build $(CLI_PACKAGES) --release --manifest-path $(CARGO_MANIFEST)

install-cli: ## Install agent-bridge and agent-bar into Cargo bin
	cargo install --path src-tauri/crates/agent-bridge --force
	cargo install --path src-tauri/crates/agent-bar-cli --force

check: ## Typecheck / compile without producing a release bundle
	npm run build
	cargo check --manifest-path $(CARGO_MANIFEST) --workspace

clean: ## Remove frontend dist and Rust target directories
	rm -rf dist
	cargo clean --manifest-path $(CARGO_MANIFEST)

clean-all: clean ## Also remove node_modules
	rm -rf node_modules
