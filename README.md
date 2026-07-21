# agent-bar

Mac menu bar app that tracks code-agent usage quotas. The first release shows **Cursor** included / remaining usage in a tray popover. Claude Code, Codex, and Grok Build are placeholders.

## Requirements

- macOS 12+
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+
- Cursor installed and signed in (agent-bar reads the local session token)

## Develop

```bash
npm install
npm run tauri dev
```

The app appears in the menu bar (no Dock icon). Click the tray item to open the popover.

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

## Features (v0.1)

- Menu bar title with compact Cursor remaining quota
- Popover with plan usage, First-Party Models/API/Total percentages, on-demand spend, billing cycle, refresh
- Background refresh every 5 minutes
- Claude Code / Codex / Grok Build “Coming soon” cards
- Cookie-based auth reserved in code (`AuthSource::Cookie`) but not implemented yet

## Build

```bash
npm run tauri build
```

## Privacy

- Access token is read from the local Cursor database on each refresh and sent only to `api2.cursor.sh` over HTTPS.
- agent-bar does not write tokens to its own config files.
