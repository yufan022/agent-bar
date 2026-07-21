import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BridgeSyncRequest, BridgeSyncResponse, BridgeToolId } from "../types";
import { BRIDGE_KINDS, BRIDGE_TOOLS } from "../types";

type BridgeTab = "status" | "sync" | "diff" | "list";

const TABS: { id: BridgeTab; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "sync", label: "Sync" },
  { id: "diff", label: "Diff" },
  { id: "list", label: "List" },
];

export function BridgePanel() {
  const [tab, setTab] = useState<BridgeTab>("status");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusTool, setStatusTool] = useState<"" | BridgeToolId>("");
  const [syncFrom, setSyncFrom] = useState<BridgeToolId>("claude");
  const [syncTo, setSyncTo] = useState<BridgeToolId[]>(["cursor"]);
  const [syncKinds, setSyncKinds] = useState<string[]>([
    "instructions",
    "skills",
    "mcp",
  ]);
  const [dryRun, setDryRun] = useState(true);
  const [prune, setPrune] = useState(false);
  const [force, setForce] = useState(false);
  const [diffFrom, setDiffFrom] = useState<BridgeToolId>("claude");
  const [diffTo, setDiffTo] = useState<BridgeToolId>("cursor");
  const [listTool, setListTool] = useState<BridgeToolId>("claude");

  const run = useCallback(async (action: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const text = await action();
      setOutput(text);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadStatus = useCallback(() => {
    void run(async () => {
      const tool = statusTool || null;
      return invoke<string>("bridge_status", { tool });
    });
  }, [run, statusTool]);

  useEffect(() => {
    if (tab === "status") {
      loadStatus();
    }
  }, [tab, loadStatus]);

  const toggleTo = (id: BridgeToolId) => {
    setSyncTo((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const toggleKind = (kind: string) => {
    setSyncKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const onSync = () => {
    const targets = syncTo.filter((t) => t !== syncFrom);
    if (targets.length === 0) {
      setError("Select at least one target different from source");
      return;
    }
    void run(async () => {
      const req: BridgeSyncRequest = {
        from: syncFrom,
        to: targets,
        only: syncKinds,
        dryRun,
        prune,
        force,
      };
      const res = await invoke<BridgeSyncResponse>("bridge_sync", { req });
      if (!res.ok) {
        setError("Sync completed with errors");
      }
      return res.report;
    });
  };

  return (
    <div className="bridge-panel">
      <nav className="agent-tabs" aria-label="Bridge actions">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              tab === item.id ? "agent-tab agent-tab-active" : "agent-tab"
            }
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "status" ? (
        <section className="card bridge-card">
          <div className="bridge-form-row">
            <label className="bridge-label" htmlFor="status-tool">
              Tool
            </label>
            <select
              id="status-tool"
              className="bridge-select"
              value={statusTool}
              onChange={(e) =>
                setStatusTool(e.target.value as "" | BridgeToolId)
              }
            >
              <option value="">All</option>
              {BRIDGE_TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="refresh-btn"
              disabled={busy}
              onClick={loadStatus}
            >
              {busy ? "…" : "Refresh"}
            </button>
          </div>
        </section>
      ) : null}

      {tab === "sync" ? (
        <section className="card bridge-card">
          <div className="bridge-form-row">
            <label className="bridge-label" htmlFor="sync-from">
              From
            </label>
            <select
              id="sync-from"
              className="bridge-select"
              value={syncFrom}
              onChange={(e) => setSyncFrom(e.target.value as BridgeToolId)}
            >
              {BRIDGE_TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="bridge-field">
            <span className="bridge-label">To</span>
            <div className="bridge-checks">
              {BRIDGE_TOOLS.filter((t) => t.id !== syncFrom).map((t) => (
                <label key={t.id} className="bridge-check">
                  <input
                    type="checkbox"
                    checked={syncTo.includes(t.id)}
                    onChange={() => toggleTo(t.id)}
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          <div className="bridge-field">
            <span className="bridge-label">Kinds</span>
            <div className="bridge-checks">
              {BRIDGE_KINDS.map((k) => (
                <label key={k.id} className="bridge-check">
                  <input
                    type="checkbox"
                    checked={syncKinds.includes(k.id)}
                    onChange={() => toggleKind(k.id)}
                  />
                  {k.label}
                </label>
              ))}
            </div>
          </div>

          <div className="bridge-checks bridge-flags">
            <label className="bridge-check">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Dry run
            </label>
            <label className="bridge-check">
              <input
                type="checkbox"
                checked={prune}
                onChange={(e) => setPrune(e.target.checked)}
              />
              Prune
            </label>
            <label className="bridge-check">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              />
              Force
            </label>
          </div>

          <button
            type="button"
            className="refresh-btn bridge-action"
            disabled={busy}
            onClick={onSync}
          >
            {busy ? "Running…" : dryRun ? "Preview sync" : "Sync"}
          </button>
        </section>
      ) : null}

      {tab === "diff" ? (
        <section className="card bridge-card">
          <div className="bridge-form-row">
            <label className="bridge-label" htmlFor="diff-from">
              From
            </label>
            <select
              id="diff-from"
              className="bridge-select"
              value={diffFrom}
              onChange={(e) => setDiffFrom(e.target.value as BridgeToolId)}
            >
              {BRIDGE_TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="bridge-form-row">
            <label className="bridge-label" htmlFor="diff-to">
              To
            </label>
            <select
              id="diff-to"
              className="bridge-select"
              value={diffTo}
              onChange={(e) => setDiffTo(e.target.value as BridgeToolId)}
            >
              {BRIDGE_TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="refresh-btn bridge-action"
            disabled={busy}
            onClick={() =>
              void run(() =>
                invoke<string>("bridge_diff", {
                  from: diffFrom,
                  to: diffTo,
                }),
              )
            }
          >
            {busy ? "…" : "Diff"}
          </button>
        </section>
      ) : null}

      {tab === "list" ? (
        <section className="card bridge-card">
          <div className="bridge-form-row">
            <label className="bridge-label" htmlFor="list-tool">
              Tool
            </label>
            <select
              id="list-tool"
              className="bridge-select"
              value={listTool}
              onChange={(e) => setListTool(e.target.value as BridgeToolId)}
            >
              {BRIDGE_TOOLS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="refresh-btn"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  invoke<string>("bridge_list", { tool: listTool }),
                )
              }
            >
              {busy ? "…" : "List"}
            </button>
          </div>
        </section>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <pre className="bridge-output" aria-live="polite">
        {output || (busy ? "Working…" : "Output will appear here")}
      </pre>
    </div>
  );
}
