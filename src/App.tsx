import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
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
type SectionView = Exclude<View, "settings">;

const SECTIONS: { id: SectionView; label: string }[] = [
  { id: "home", label: "Usage" },
  { id: "monitor", label: "Monitor" },
  { id: "bridge", label: "Bridge" },
];

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

function SectionTabs({
  view,
  onChange,
}: {
  view: SectionView;
  onChange: (view: SectionView) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % SECTIONS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + SECTIONS.length) % SECTIONS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = SECTIONS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const target = SECTIONS[next];
    if (!target) {
      return;
    }
    onChange(target.id);
    document.getElementById(`section-tab-${target.id}`)?.focus();
  };

  return (
    <nav className="agent-tabs section-tabs" role="tablist" aria-label="Sections">
      {SECTIONS.map((section, index) => {
        const selected = view === section.id;
        return (
          <button
            key={section.id}
            id={`section-tab-${section.id}`}
            type="button"
            role="tab"
            className={selected ? "agent-tab agent-tab-active" : "agent-tab"}
            aria-selected={selected}
            aria-controls="content"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(section.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {section.label}
          </button>
        );
      })}
    </nav>
  );
}

function App() {
  const [view, setView] = useState<View>("home");
  const sectionRef = useRef<SectionView>("home");
  if (view !== "settings") {
    sectionRef.current = view;
  }
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
          {view === "settings" ? (
            <button
              type="button"
              className="refresh-btn"
              onClick={() => setView(sectionRef.current)}
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label="Settings"
                title="Settings"
                onClick={() => setView("settings")}
              >
                <SettingsIcon />
              </button>
              {view === "home" ? (
                <button
                  type="button"
                  className="refresh-btn"
                  onClick={() => void refresh()}
                  disabled={refreshing}
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {view === "settings" ? null : (
        <SectionTabs view={view} onChange={setView} />
      )}

      <main
        id="content"
        className="content"
        tabIndex={-1}
        role={view === "settings" ? undefined : "tabpanel"}
        aria-labelledby={view === "settings" ? undefined : `section-tab-${view}`}
      >
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
