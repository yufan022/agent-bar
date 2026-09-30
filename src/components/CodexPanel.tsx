import type { CreditBalance, QuotaSnapshot, UsageWindow } from "../types";
import { formatTime } from "../types";

interface Props {
  snapshot: QuotaSnapshot;
}

function toneFor(usedPercent: number): "critical" | "warn" | "ok" {
  if (usedPercent >= 90) {
    return "critical";
  }
  if (usedPercent >= 80) {
    return "warn";
  }
  return "ok";
}

function formatPlan(plan: string | null): string | null {
  if (!plan) {
    return null;
  }
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatResetIn(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) {
    return null;
  }
  const total = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatCredits(credits: CreditBalance): string {
  if (credits.unlimited) {
    return "Unlimited";
  }
  if (!credits.balance) {
    return "—";
  }
  const amount = Number(credits.balance);
  if (Number.isNaN(amount)) {
    return credits.balance;
  }
  return `$${amount.toFixed(2)}`;
}

function WindowMeter({ window }: { window: UsageWindow }) {
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const reset = formatResetIn(window.resetsAt);
  const tone = toneFor(used);

  return (
    <div className="percent-metric">
      <div className="metric-row">
        <span>{window.label}</span>
        <strong>{Math.round(used)}% used</strong>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={`${window.label} used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
      >
        <div
          className={`progress-fill progress-${tone}`}
          style={{ width: `${used}%` }}
        />
      </div>
      <p className="muted window-reset">
        {reset ? `Resets in ${reset}` : "Reset time unavailable"}
      </p>
    </div>
  );
}

export function CodexPanel({ snapshot }: Props) {
  const isError = snapshot.status === "error";
  const subtitle =
    [formatPlan(snapshot.membershipType), snapshot.email]
      .filter(Boolean)
      .join(" · ") || "ChatGPT session";

  return (
    <section className="card agent-card" aria-label="Codex quota">
      <header className="card-header">
        <div>
          <h2>Codex</h2>
          <p className="muted">{subtitle}</p>
        </div>
        <div className="remaining-pill">
          {isError ? "Error" : formatRemainingPill(snapshot)}
        </div>
      </header>

      {isError ? (
        <p className="error-text" role="alert">
          {snapshot.error || "Failed to load Codex usage."}
        </p>
      ) : (
        <>
          {snapshot.displayMessage ? (
            <p className="display-message">{snapshot.displayMessage}</p>
          ) : null}

          {snapshot.windows.length > 0 ? (
            <div className="split-grid">
              {snapshot.windows.map((window) => (
                <WindowMeter
                  key={`${window.shortLabel}-${window.label}`}
                  window={window}
                />
              ))}
            </div>
          ) : null}

          {snapshot.extraWindows.length > 0 ? (
            <div className="subsection">
              <h3>Other limits</h3>
              <div className="split-grid">
                {snapshot.extraWindows.map((window) => (
                  <WindowMeter
                    key={`${window.shortLabel}-${window.label}`}
                    window={window}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {snapshot.credits ? (
            <div className="subsection">
              <h3>Credits</h3>
              <div className="metric-row">
                <span>Balance</span>
                <strong>{formatCredits(snapshot.credits)}</strong>
              </div>
            </div>
          ) : null}

          {snapshot.earnedResets !== null && snapshot.earnedResets > 0 ? (
            <div className="metric-row">
              <span>Earned resets</span>
              <strong>{snapshot.earnedResets}</strong>
            </div>
          ) : null}

          <p className="footer-meta">
            Updated {formatTime(snapshot.fetchedAt)}
          </p>
        </>
      )}
    </section>
  );
}

function scarcerWindow(windows: UsageWindow[]): UsageWindow | undefined {
  return windows.reduce<UsageWindow | undefined>((best, window) => {
    if (!best || window.usedPercent > best.usedPercent) {
      return window;
    }
    return best;
  }, undefined);
}

function formatRemainingPill(snapshot: QuotaSnapshot): string {
  const window = scarcerWindow(snapshot.windows);
  if (!window) {
    if (snapshot.remaining === null || Number.isNaN(snapshot.remaining)) {
      return "—";
    }
    return `${Math.round(snapshot.remaining)}% left`;
  }
  const left = Math.max(0, 100 - window.usedPercent);
  return `${window.shortLabel} ${Math.round(left)}% left`;
}
