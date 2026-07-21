import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AgentPlaceholder } from "./components/AgentPlaceholder";
import { CursorPanel } from "./components/CursorPanel";
import type { AgentsQuotaResponse, QuotaSnapshot } from "./types";
import { formatTime } from "./types";

function findAgent(
  agents: QuotaSnapshot[],
  id: string,
): QuotaSnapshot | undefined {
  return agents.find((agent) => agent.providerId === id);
}

function App() {
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

    let unlisten: (() => void) | undefined;
    void listen<AgentsQuotaResponse>("quota-updated", (event) => {
      setData(event.payload);
      setError(null);
      setLoading(false);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [loadCached, refresh]);

  const cursor = data ? findAgent(data.agents, "cursor") : undefined;

  return (
    <div className="shell">
      <header className="top-bar">
        <div>
          <h1>agent-bar</h1>
          <p className="muted">
            {data
              ? `Last refresh ${formatTime(data.refreshedAt)}`
              : "Loading usage…"}
          </p>
        </div>
        <button
          className="refresh-btn"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <main className="content">
        {loading && !data ? <p className="muted">Fetching Cursor usage…</p> : null}
        {error && !cursor ? <p className="error-text">{error}</p> : null}

        {cursor ? <CursorPanel snapshot={cursor} /> : null}
        <AgentPlaceholder name="Claude Code" />
        <AgentPlaceholder name="Codex" />
      </main>
    </div>
  );
}

export default App;
