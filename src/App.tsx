import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AgentPlaceholder } from "./components/AgentPlaceholder";
import { BridgePanel } from "./components/BridgePanel";
import { CodexPanel } from "./components/CodexPanel";
import { CursorPanel } from "./components/CursorPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import type { AgentsQuotaResponse, QuotaSnapshot } from "./types";
import { formatTime } from "./types";

type View = "home" | "settings" | "bridge";
type AgentTab = "cursor" | "claude-code" | "codex" | "grok-build";

const AGENT_TABS: { id: AgentTab; label: string }[] = [
  { id: "cursor", label: "Cursor" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "grok-build", label: "Grok Build" },
];

function findAgent(
  agents: QuotaSnapshot[],
  id: string,
): QuotaSnapshot | undefined {
  return agents.find((agent) => agent.providerId === id);
}

function SettingsIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function BridgeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8h12" />
      <path d="M6 16h12" />
      <path d="M8 8v8" />
      <path d="M16 8v8" />
      <path d="M4 12h4" />
      <path d="M16 12h4" />
    </svg>
  );
}

function titleForView(view: View): string {
  switch (view) {
    case "settings":
      return "Settings";
    case "bridge":
      return "Bridge";
    default:
      return "agent-bar";
  }
}

function subtitleForView(
  view: View,
  data: AgentsQuotaResponse | null,
): string {
  switch (view) {
    case "settings":
      return "Preferences";
    case "bridge":
      return "Sync instructions, skills & MCP";
    default:
      return data
        ? `Last refresh ${formatTime(data.refreshedAt)}`
        : "Loading usage…";
  }
}

function App() {
  const [view, setView] = useState<View>("home");
  const [agentTab, setAgentTab] = useState<AgentTab>("cursor");
  const [data, setData] = useState<AgentsQuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCached = useCallback(async () => {
    try {
      const response = await invoke<AgentsQuotaResponse>("get_agents_quota");
      setData(response);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await invoke<AgentsQuotaResponse>("refresh_quota");
      setData(response);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCached();
    void refresh();

    let unlistenQuota: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;

    void listen<AgentsQuotaResponse>("quota-updated", (event) => {
      setData(event.payload);
      setError(null);
      setLoading(false);
    }).then((fn) => {
      unlistenQuota = fn;
    });

    void listen("open-settings", () => {
      setView("settings");
    }).then((fn) => {
      unlistenSettings = fn;
    });

    return () => {
      if (unlistenQuota) {
        unlistenQuota();
      }
      if (unlistenSettings) {
        unlistenSettings();
      }
    };
  }, [loadCached, refresh]);

  const cursor = data ? findAgent(data.agents, "cursor") : undefined;
  const codex = data ? findAgent(data.agents, "codex") : undefined;

  return (
    <div className="shell">
      <header className="top-bar">
        <div>
          <h1>{titleForView(view)}</h1>
          <p className="muted">{subtitleForView(view, data)}</p>
        </div>
        <div className="top-bar-actions">
          {view === "home" ? (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label="Bridge"
                title="Bridge"
                onClick={() => setView("bridge")}
              >
                <BridgeIcon />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Settings"
                title="Settings"
                onClick={() => setView("settings")}
              >
                <SettingsIcon />
              </button>
              <button
                type="button"
                className="refresh-btn"
                onClick={() => void refresh()}
                disabled={refreshing}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="refresh-btn"
              onClick={() => setView("home")}
            >
              Done
            </button>
          )}
        </div>
      </header>

      <main className="content">
        {view === "settings" ? <SettingsPanel /> : null}
        {view === "bridge" ? <BridgePanel /> : null}
        {view === "home" ? (
          <>
            <nav className="agent-tabs" aria-label="Agents">
              {AGENT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={
                    agentTab === tab.id
                      ? "agent-tab agent-tab-active"
                      : "agent-tab"
                  }
                  aria-selected={agentTab === tab.id}
                  onClick={() => setAgentTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            {agentTab === "cursor" ? (
              <>
                {loading && !data ? (
                  <p className="muted">Fetching Cursor usage…</p>
                ) : null}
                {error && !cursor ? (
                  <p className="error-text">{error}</p>
                ) : null}
                {cursor ? <CursorPanel snapshot={cursor} /> : null}
              </>
            ) : null}

            {agentTab === "claude-code" ? (
              <AgentPlaceholder name="Claude Code" />
            ) : null}

            {agentTab === "codex" ? (
              <>
                {loading && !data ? (
                  <p className="muted">Fetching Codex usage…</p>
                ) : null}
                {error && !codex ? <p className="error-text">{error}</p> : null}
                {codex ? <CodexPanel snapshot={codex} /> : null}
              </>
            ) : null}

            {agentTab === "grok-build" ? (
              <AgentPlaceholder name="Grok Build" />
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

export default App;
