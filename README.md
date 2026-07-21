# agent-bar

Mac menu bar app that tracks code-agent usage quotas and syncs global agent configs (instructions, skills, MCP) across Claude Code, Codex, OpenCode, and Cursor.

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
- Popover with plan usage, First-Party Models/API/Total percentages, on-demand spend, billing cycle, refresh
- Background refresh every 5 minutes
- Claude Code / Codex / Grok Build “Coming soon” cards
- Launch at login (Settings)

### Bridge (UI + CLI)

Sync **user-global** instructions, skills, and MCP between:

| Tool | Instructions | Skills | MCP |
|------|--------------|--------|-----|
| Claude | `~/.claude/CLAUDE.md` | `~/.claude/skills/` | `~/.claude.json` |
| Codex | `~/.codex/AGENTS.md` | `~/.codex/skills/` | `~/.codex/config.toml` |
| OpenCode | `~/.config/opencode/AGENTS.md` | `~/.config/opencode/skills/` | `~/.config/opencode/opencode.json` |
| Cursor | *(not supported)* | *(not synced)* | `~/.cursor/mcp.json` |

- Instructions / skills: symlink to the source real path
- MCP: convert via an internal IR and merge safely (other config keys preserved)
- Cursor has no stable file-based User Rules API, so instructions are skipped; skill sync to Cursor is also disabled (only MCP is written)

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
agent-bridge sync --from claude --to cursor,codex,opencode
agent-bridge sync --from claude --to cursor --dry-run
agent-bridge sync --from cursor --to claude --only skills,mcp --force
agent-bridge sync --from claude --to cursor --prune
agent-bridge diff --from claude --to cursor
agent-bridge status
agent-bridge list --tool claude
```

### `agent-bar bridge`

```bash
agent-bar bridge sync --from claude --to cursor,codex --dry-run
agent-bar bridge diff --from claude --to cursor
agent-bar bridge status
agent-bar bridge list --tool claude
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
- agent-bar does not write tokens to its own config files.
- Bridge only reads/writes local agent config paths under your home directory.
