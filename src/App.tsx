import { useCallback, useEffect, useState } from "react";
import { getAgentsQuota, onOpenMonitor, onOpenSettings, onQuotaUpdated, refreshQuota } from "./api";
import { AgentPlaceholder } from "./components/AgentPlaceholder";
import { BridgePanel } from "./components/BridgePanel";
import { CodexPanel } from "./components/CodexPanel";
import { CursorPanel } from "./components/CursorPanel";
import { MonitorPanel } from "./components/MonitorPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import type { AgentsQuotaResponse, QuotaSnapshot } from "./types";
import { formatTime } from "./types";

type View = "home" | "settings" | "bridge" | "monitor";

function boardAgents(agents: QuotaSnapshot[]): QuotaSnapshot[] {
  return [...agents].sort((a, b) => {
    const rank = (status: QuotaSnapshot["status"]) =>
      status === "comingSoon" ? 1 : 0;
    return rank(a.status) - rank(b.status);
  });
}

function AgentSection({ snapshot }: { snapshot: QuotaSnapshot }) {
  if (snapshot.status === "comingSoon") {
    return <AgentPlaceholder name={snapshot.providerName} />;
  }
  if (snapshot.providerId === "cursor") {
    return <CursorPanel snapshot={snapshot} />;
  }
  if (snapshot.providerId === "codex") {
    return <CodexPanel snapshot={snapshot} />;
  }
  return <AgentPlaceholder name={snapshot.providerName} />;
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

function MonitorIcon() {
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
      aria-hidden="true"
    >
      <path d="M3 12h3l2-5 4 10 2-5h7" />
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
    case "monitor":
      return "Monitor";
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
    case "monitor":
      return "This Mac";
    default:
      return data
        ? `Last refresh ${formatTime(data.refreshedAt)}`
        : "Loading usage…";
  }
}

function App() {
  const [view, setView] = useState<View>("home");
  const [data, setData] = useState<AgentsQuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCached = useCallback(async () => {
    try {
      const response = await getAgentsQuota();
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
      const response = await refreshQuota();
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

    const unlistenQuota = onQuotaUpdated((payload) => {
      setData(payload);
      setError(null);
      setLoading(false);
    });
    const unlistenSettings = onOpenSettings(() => {
      setView("settings");
    });
    const unlistenMonitor = onOpenMonitor(() => {
      setView("monitor");
    });

    return () => {
      if (unlistenQuota) {
        unlistenQuota();
      }
      if (unlistenSettings) {
        unlistenSettings();
      }
      if (unlistenMonitor) {
        unlistenMonitor();
      }
    };
  }, [loadCached, refresh]);

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
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
                aria-label="Monitor"
                title="Monitor"
                onClick={() => setView("monitor")}
              >
                <MonitorIcon />
              </button>
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

      <main id="content" className="content" tabIndex={-1}>
        {view === "settings" ? <SettingsPanel /> : null}
        {view === "bridge" ? <BridgePanel /> : null}
        {view === "monitor" ? <MonitorPanel /> : null}
        {view === "home" ? (
          <div className="agent-board" aria-busy={loading && !data}>
            {loading && !data ? (
              <p className="muted agent-span">Fetching usage…</p>
            ) : null}
            {error ? (
              <p className="error-text agent-span" role="alert">
                {error}
              </p>
            ) : null}
            {data
              ? boardAgents(data.agents).map((snapshot) => (
                  <AgentSection
                    key={snapshot.providerId}
                    snapshot={snapshot}
                  />
                ))
              : null}
            {data && data.agents.length === 0 ? (
              <p className="muted agent-span">No agent usage yet.</p>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default App;
