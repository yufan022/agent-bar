import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BridgeSyncRequest,
  BridgeSyncResponse,
  BridgeToolId,
  DetailsReport,
  DiffChange,
  DiffReport,
  StatusReport,
  SyncLine,
  SyncLineStatus,
  SyncReport,
  ToolStatus,
} from "../types";
import { BRIDGE_KINDS, BRIDGE_TOOLS, bridgeToolLabel } from "../types";

type BridgeTab = "status" | "sync" | "diff";

const TABS: { id: BridgeTab; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "sync", label: "Sync" },
  { id: "diff", label: "Diff" },
];

function asBridgeToolId(tool: string): BridgeToolId | null {
  return BRIDGE_TOOLS.some((t) => t.id === tool)
    ? (tool as BridgeToolId)
    : null;
}

function shortPath(path: string): string {
  if (path.length <= 42) {
    return path;
  }
  return `…${path.slice(-40)}`;
}

function PresenceDot({
  tone,
  label,
}: {
  tone: "ok" | "missing" | "na";
  label: string;
}) {
  return (
    <span className={`bridge-dot bridge-dot-${tone}`} title={label}>
      <span className="bridge-dot-mark" aria-hidden />
      {label}
    </span>
  );
}

function instructionsTone(
  status: ToolStatus["instructions"],
): "ok" | "missing" | "na" {
  if (status.state === "unsupported") {
    return "na";
  }
  if (status.state === "present") {
    return "ok";
  }
  return "missing";
}

function StatusToolCard({
  tool,
  onOpen,
}: {
  tool: ToolStatus;
  onOpen: (tool: string) => void;
}) {
  const instrTone = instructionsTone(tool.instructions);
  const instrLabel =
    tool.instructions.state === "unsupported"
      ? "Instructions n/a"
      : tool.instructions.state === "present"
        ? "Instructions"
        : "Instructions missing";

  const instrPath =
    tool.instructions.state === "unsupported"
      ? "(unsupported)"
      : tool.instructions.path;

  return (
    <button
      type="button"
      className="bridge-result-card bridge-result-card-btn"
      onClick={() => onOpen(tool.tool)}
    >
      <header className="bridge-result-header">
        <div className="bridge-result-title">
          <h3>{bridgeToolLabel(tool.tool)}</h3>
          <span className="bridge-card-hint">Details →</span>
        </div>
        <div className="bridge-dots">
          <PresenceDot tone={instrTone} label={instrLabel} />
          <PresenceDot
            tone={tool.skillsDir.exists ? "ok" : "missing"}
            label="Skills"
          />
          <PresenceDot
            tone={tool.mcpConfig.exists ? "ok" : "missing"}
            label="MCP"
          />
        </div>
      </header>

      <div className="bridge-metrics">
        <div className="bridge-metric">
          <span className="bridge-metric-label">Chars</span>
          <strong>
            {tool.instructions.state === "present"
              ? tool.instructions.chars.toLocaleString()
              : "—"}
          </strong>
        </div>
        <div className="bridge-metric">
          <span className="bridge-metric-label">Skills</span>
          <strong>{tool.skillCount}</strong>
        </div>
        <div className="bridge-metric">
          <span className="bridge-metric-label">MCP</span>
          <strong>{tool.mcpServerCount}</strong>
        </div>
      </div>

      <div className="bridge-path-list">
        <div className="bridge-path-row">
          <span>Instructions</span>
          <code title={instrPath}>{shortPath(instrPath)}</code>
        </div>
        {tool.instructions.state === "present" && tool.instructions.realPath ? (
          <div className="bridge-path-row">
            <span>Real path</span>
            <code title={tool.instructions.realPath}>
              {shortPath(tool.instructions.realPath)}
            </code>
          </div>
        ) : null}
        <div className="bridge-path-row">
          <span>Skills dir</span>
          <code title={tool.skillsDir.path}>
            {shortPath(tool.skillsDir.path)}
          </code>
        </div>
        <div className="bridge-path-row">
          <span>MCP config</span>
          <code title={tool.mcpConfig.path}>
            {shortPath(tool.mcpConfig.path)}
          </code>
        </div>
      </div>
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="bridge-empty">{text}</p>;
}

function NamedDiffList({
  title,
  entries,
}: {
  title: string;
  entries: { name: string; change: DiffChange }[];
}) {
  return (
    <section className="bridge-section">
      <h4>{title}</h4>
      {entries.length === 0 ? (
        <EmptyHint text="None" />
      ) : (
        <ul className="bridge-named-list">
          {entries.map((entry) => (
            <li key={`${entry.change}-${entry.name}`}>
              <span className={`bridge-change bridge-change-${entry.change}`}>
                {entry.change === "added"
                  ? "+"
                  : entry.change === "removed"
                    ? "−"
                    : entry.change === "changed"
                      ? "~"
                      : "="}
              </span>
              <span>{entry.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function syncStatusLabel(status: SyncLineStatus): string {
  switch (status) {
    case "ok":
      return "OK";
    case "skip":
      return "Skip";
    case "plan":
      return "Plan";
    case "done":
      return "Done";
    case "error":
      return "Error";
    default:
      return "Info";
  }
}

function SyncLineRow({ line }: { line: SyncLine }) {
  const [open, setOpen] = useState(false);
  const hasDetail = (line.detail?.length ?? 0) > 0;

  return (
    <li className={`bridge-sync-line bridge-sync-${line.status}`}>
      <div className="bridge-sync-main">
        <span className={`bridge-sync-badge bridge-sync-badge-${line.status}`}>
          {syncStatusLabel(line.status)}
        </span>
        <span className="bridge-sync-msg">{line.message}</span>
        {hasDetail ? (
          <button
            type="button"
            className="bridge-detail-toggle"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide" : "Detail"}
          </button>
        ) : null}
      </div>
      {open && hasDetail ? (
        <pre className="bridge-detail-block">{line.detail?.join("\n")}</pre>
      ) : null}
    </li>
  );
}

function StatusView({
  report,
  onOpenTool,
}: {
  report: StatusReport | null;
  onOpenTool: (tool: string) => void;
}) {
  if (!report) {
    return <EmptyHint text="Load status to see tool readiness." />;
  }
  if (report.tools.length === 0) {
    return <EmptyHint text="No tools found." />;
  }
  return (
    <div className="bridge-results">
      {report.tools.map((tool) => (
        <StatusToolCard key={tool.tool} tool={tool} onOpen={onOpenTool} />
      ))}
    </div>
  );
}

function DetailsView({
  report,
  onBack,
  busy,
}: {
  report: DetailsReport | null;
  onBack: () => void;
  busy: boolean;
}) {
  if (!report) {
    return (
      <div className="bridge-results">
        <button type="button" className="bridge-back-btn" onClick={onBack}>
          ← Back
        </button>
        <EmptyHint text={busy ? "Loading…" : "Failed to load tool details."} />
      </div>
    );
  }

  const instrLabel =
    report.instructions.state === "unsupported"
      ? "Unsupported"
      : report.instructions.state === "present"
        ? `Present · ${report.instructions.chars.toLocaleString()} chars`
        : "Missing";

  return (
    <div className="bridge-results">
      <button type="button" className="bridge-back-btn" onClick={onBack}>
        ← Status
      </button>
      <article className="bridge-result-card">
        <header className="bridge-result-header">
          <h3>{bridgeToolLabel(report.tool)}</h3>
          <span className="bridge-pill">{instrLabel}</span>
        </header>

        <section className="bridge-section">
          <h4>Instructions</h4>
          <div className="bridge-path-row">
            <span>Path</span>
            <code title={report.instructions.path}>
              {shortPath(report.instructions.path)}
            </code>
          </div>
        </section>

        <section className="bridge-section">
          <h4>Skills ({report.skills.length})</h4>
          {report.skills.length === 0 ? (
            <EmptyHint text="No skills" />
          ) : (
            <ul className="bridge-named-list">
              {report.skills.map((skill) => (
                <li key={skill.name}>
                  <strong>{skill.name}</strong>
                  <code title={skill.path}>{shortPath(skill.path)}</code>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bridge-section">
          <h4>MCP servers ({report.mcpServers.length})</h4>
          {report.mcpServers.length === 0 ? (
            <EmptyHint text="No MCP servers" />
          ) : (
            <ul className="bridge-named-list">
              {report.mcpServers.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </article>
    </div>
  );
}

function DiffView({ report }: { report: DiffReport | null }) {
  if (!report) {
    return <EmptyHint text="Run Diff to compare two tools." />;
  }

  return (
    <div className="bridge-results">
      <article className="bridge-result-card">
        <header className="bridge-result-header">
          <h3>
            {bridgeToolLabel(report.from)} → {bridgeToolLabel(report.to)}
          </h3>
        </header>

        <section className="bridge-section">
          <h4>Instructions</h4>
          {report.instructions.state === "skipped" ? (
            <EmptyHint text={report.instructions.reason} />
          ) : (
            <>
              <p className="bridge-inline-note">
                {report.instructions.identical
                  ? "Identical real path"
                  : "Paths differ"}
              </p>
              <pre className="bridge-detail-block">
                {report.instructions.summary.trimEnd()}
              </pre>
            </>
          )}
        </section>

        <NamedDiffList title="Skills" entries={report.skills} />
        <NamedDiffList title="MCP" entries={report.mcp} />
      </article>
    </div>
  );
}

function SyncView({ report }: { report: SyncReport | null }) {
  if (!report) {
    return <EmptyHint text="Configure sync and run a preview or sync." />;
  }

  return (
    <div className="bridge-results">
      <article className="bridge-result-card">
        <header className="bridge-result-header">
          <div>
            <h3>Source · {bridgeToolLabel(report.sourceTool)}</h3>
            <p className="muted" title={report.sourceHome}>
              {shortPath(report.sourceHome)}
              {report.dryRun ? " · dry run" : ""}
            </p>
          </div>
        </header>

        {report.notes.length > 0 ? (
          <ul className="bridge-sync-list">
            {report.notes.map((line, idx) => (
              <SyncLineRow key={`note-${idx}`} line={line} />
            ))}
          </ul>
        ) : null}

        {report.targets.map((target) => (
          <section key={target.tool} className="bridge-section">
            <h4>Target · {bridgeToolLabel(target.tool)}</h4>
            <ul className="bridge-sync-list">
              {target.items.map((line, idx) => (
                <SyncLineRow key={`${target.tool}-${idx}`} line={line} />
              ))}
            </ul>
          </section>
        ))}

        {report.errors.length > 0 ? (
          <section className="bridge-section">
            <h4>Errors</h4>
            <ul className="bridge-error-list">
              {report.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </div>
  );
}

export function BridgePanel() {
  const [tab, setTab] = useState<BridgeTab>("status");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusTool, setStatusTool] = useState<"" | BridgeToolId>("");
  const [statusReport, setStatusReport] = useState<StatusReport | null>(null);

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
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);

  const [diffFrom, setDiffFrom] = useState<BridgeToolId>("claude");
  const [diffTo, setDiffTo] = useState<BridgeToolId>("cursor");
  const [diffReport, setDiffReport] = useState<DiffReport | null>(null);

  const [detailsTool, setDetailsTool] = useState<BridgeToolId | null>(null);
  const [detailsReport, setDetailsReport] = useState<DetailsReport | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const loadStatus = useCallback(() => {
    void run(async () => {
      const tool = statusTool || null;
      const report = await invoke<StatusReport>("bridge_status", { tool });
      setStatusReport(report);
    });
  }, [run, statusTool]);

  const openToolDetails = useCallback(
    (toolName: string) => {
      const tool = asBridgeToolId(toolName);
      if (!tool) {
        setError(`Unknown tool: ${toolName}`);
        return;
      }
      setDetailsTool(tool);
      setDetailsReport(null);
      void run(async () => {
        const report = await invoke<DetailsReport>("bridge_details", { tool });
        setDetailsReport(report);
      });
    },
    [run],
  );

  const closeToolDetails = useCallback(() => {
    setDetailsTool(null);
    setDetailsReport(null);
  }, []);

  useEffect(() => {
    if (tab === "status" && detailsTool === null) {
      loadStatus();
    }
  }, [tab, detailsTool, loadStatus]);

  useEffect(() => {
    if (tab !== "status") {
      closeToolDetails();
    }
  }, [tab, closeToolDetails]);

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
      setSyncReport(res.report);
    });
  };

  const showingDetails = tab === "status" && detailsTool !== null;

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

      {tab === "status" && !showingDetails ? (
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
              void run(async () => {
                const report = await invoke<DiffReport>("bridge_diff", {
                  from: diffFrom,
                  to: diffTo,
                });
                setDiffReport(report);
              })
            }
          >
            {busy ? "…" : "Diff"}
          </button>
        </section>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <div className="bridge-result-area" aria-live="polite">
        {tab === "status" ? (
          showingDetails ? (
            <DetailsView
              report={detailsReport}
              onBack={closeToolDetails}
              busy={busy}
            />
          ) : busy && !statusReport ? (
            <EmptyHint text="Loading…" />
          ) : (
            <StatusView report={statusReport} onOpenTool={openToolDetails} />
          )
        ) : null}
        {tab === "diff" ? <DiffView report={diffReport} /> : null}
        {tab === "sync" ? <SyncView report={syncReport} /> : null}
      </div>
    </div>
  );
}
