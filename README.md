# agent-bar

Mac menu bar app that tracks code-agent usage quotas and syncs global agent configs (instructions, skills, MCP) across Claude Code, Codex, OpenCode, Cursor, Pi, and OMP.

## Requirements

- macOS 12+
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+
- Cursor installed and signed in (quota view reads the local session token)

## Develop

```bash
npm install
npm run tauri dev
```

The app appears in the menu bar (no Dock icon). Click the tray item to open the popover.

## Features

### Quota (tray)

- Menu bar icon with Cursor remaining quota in the tooltip
- Popover with plan usage, First-Party Models/API percentages, on-demand spend, billing cycle, refresh
- Codex card with the 5-hour and weekly ChatGPT rate-limit windows
- Background refresh every 5 minutes
- Claude Code / Grok Build “Coming soon” cards
- Launch at login (Settings)

### Bridge (UI + CLI)

Sync **user-global** instructions, skills, and MCP between:

| Tool | Instructions | Skills | MCP |
|------|--------------|--------|-----|
| Claude | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude.json` |
| Codex | `~/.codex/AGENTS.md` | `~/.codex/skills/` | `~/.codex/config.toml` |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/skills/` | `~/.config/opencode/opencode.json` |
| Cursor | *(not supported)* | `~/.cursor/skills/` | `~/.cursor/mcp.json` |
| Pi | `~/.pi/agent/AGENTS.md` | `~/.pi/agent/skills/` | `~/.pi/agent/mcp.json` |
| OMP | `~/.omp/agent/AGENTS.md` | `~/.omp/agent/skills/` | `~/.omp/agent/mcp.json` |

- Instructions / skills: symlink to the source real path
- MCP: convert via an internal IR and merge safely (other config keys preserved)
- Cursor has no stable file-based User Rules API, so instructions are skipped; skills and MCP are still written
- Pi MCP uses Claude-compatible `mcpServers` JSON (`${VAR}` env interpolation); other keys such as `settings` are preserved
- OMP MCP uses the same Claude-compatible `mcpServers` JSON; other keys such as `$schema` and `disabledServers` are preserved

In the popover, open **Bridge** (icon next to Settings) for Status / Sync / Diff. Click a tool on Status to open its inventory.

## CLI

Two binaries share the same core:

```bash
# Compatible drop-in (same surface as the original agent-bridge project)
cargo install --path src-tauri/crates/agent-bridge

# agent-bar entry with a `bridge` subcommand group
cargo install --path src-tauri/crates/agent-bar-cli
```

Or build both:

```bash
cargo build -p agent-bridge -p agent-bar-cli --release --manifest-path src-tauri/Cargo.toml
```

### `agent-bridge` (compatible)

```bash
agent-bridge sync --from claude --to cursor,codex,opencode,pi,omp
agent-bridge sync --from claude --to cursor --dry-run
agent-bridge sync --from cursor --to claude --only skills,mcp --force
agent-bridge sync --from claude --to cursor --prune
agent-bridge diff --from claude --to cursor
agent-bridge status
agent-bridge details --tool claude
```

### `agent-bar bridge`

```bash
agent-bar bridge sync --from claude --to cursor,codex,pi,omp --dry-run
agent-bar bridge diff --from claude --to cursor
agent-bar bridge status
agent-bar bridge details --tool claude
```

## How Cursor usage is loaded

1. Read `cursorAuth/accessToken` from  
   `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`  
   (read-only; token is not cached to disk by agent-bar).
2. Call undocumented Cursor HTTPS endpoints on `https://api2.cursor.sh`:
   - `POST /aiserver.v1.DashboardService/GetCurrentPeriodUsage`
   - `GET /auth/usage`
   - `GET /api/usage/summary`
3. Merge responses into one snapshot (dollar allowance for Pro/Team/Ultra when present; otherwise request buckets).

These endpoints are unofficial and may change without notice.

## How Codex usage is loaded

1. Read the ChatGPT session from `auth.json` (`$CODEX_HOME/auth.json`, otherwise `~/.codex/auth.json`). The file is read on each refresh and is not copied into agent-bar config.
2. Call `GET https://chatgpt.com/backend-api/wham/usage` with that access token.
3. Show the primary window (usually 5 hours) and the secondary window (usually 7 days) as percent used, plus credits when the balance is non-zero.

API-key sign-in has no ChatGPT plan window. A 401 means the local session expired; open Codex and sign in again. This endpoint is unofficial and may change without notice. agent-bar does not refresh or rewrite Codex tokens.

## Build app

```bash
npm run tauri build
```

## Tests

```bash
cargo test -p agent-bridge-core --manifest-path src-tauri/Cargo.toml
```

## Privacy

- Access token is read from the local Cursor database on each refresh and sent only to `api2.cursor.sh` over HTTPS.
- Codex access token is read from local `auth.json` on each refresh and sent only to `chatgpt.com` over HTTPS.
- agent-bar does not write tokens to its own config files.
- Bridge only reads/writes local agent config paths under your home directory.
