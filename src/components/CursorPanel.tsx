import type { QuotaSnapshot } from "../types";
import {
  formatAmount,
  formatDate,
  formatRemaining,
  formatTime,
  percentUsed,
} from "../types";

interface Props {
  snapshot: QuotaSnapshot;
}

function ProgressBar({ value }: { value: number | null }) {
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const tone =
    clamped >= 90 ? "critical" : clamped >= 80 ? "warn" : "ok";

  return (
    <div className="progress-track" aria-hidden>
      <div
        className={`progress-fill progress-${tone}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function MetricRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CursorPanel({ snapshot }: Props) {
  const pct = percentUsed(snapshot);
  const isError = snapshot.status === "error";

  return (
    <section className="card agent-card">
      <header className="card-header">
        <div>
          <h2>Cursor</h2>
          <p className="muted">
            {[snapshot.membershipType, snapshot.email]
              .filter(Boolean)
              .join(" · ") || "Local session"}
          </p>
        </div>
        <div className="remaining-pill">
          {isError ? "Error" : formatRemaining(snapshot.remaining, snapshot.unit)}
        </div>
      </header>

      {isError ? (
        <p className="error-text">
          {snapshot.error || "Failed to load Cursor usage."}
        </p>
      ) : (
        <>
          {snapshot.displayMessage ? (
            <p className="display-message">{snapshot.displayMessage}</p>
          ) : null}

          <div className="hero-metric">
            <div className="hero-numbers">
              <span className="hero-remaining">
                {formatRemaining(snapshot.remaining, snapshot.unit)}
              </span>
              <span className="muted">
                {formatAmount(snapshot.used, snapshot.unit)} /{" "}
                {formatAmount(snapshot.limit, snapshot.unit)} used
              </span>
            </div>
            <ProgressBar value={pct} />
            <div className="percent-label">
              {pct === null ? "—" : `${pct.toFixed(1)}% used`}
            </div>
          </div>

          <div className="split-grid">
            <MetricRow
              label="First-Party Models"
              value={
                snapshot.autoPercentUsed === null
                  ? "—"
                  : `${snapshot.autoPercentUsed.toFixed(1)}%`
              }
            />
            <MetricRow
              label="API"
              value={
                snapshot.apiPercentUsed === null
                  ? "—"
                  : `${snapshot.apiPercentUsed.toFixed(1)}%`
              }
            />
            <MetricRow
              label="Total"
              value={
                snapshot.totalPercentUsed === null
                  ? "—"
                  : `${snapshot.totalPercentUsed.toFixed(1)}%`
              }
            />
          </div>

          {snapshot.onDemand ? (
            <div className="subsection">
              <h3>On-demand</h3>
              <MetricRow
                label="Used"
                value={formatAmount(
                  snapshot.onDemand.used,
                  snapshot.onDemand.unit,
                )}
              />
              <MetricRow
                label="Limit"
                value={formatAmount(
                  snapshot.onDemand.limit,
                  snapshot.onDemand.unit,
                )}
              />
              <MetricRow
                label="Remaining"
                value={formatAmount(
                  snapshot.onDemand.remaining,
                  snapshot.onDemand.unit,
                )}
              />
            </div>
          ) : null}

          <div className="subsection">
            <h3>Billing cycle</h3>
            <MetricRow
              label="Start"
              value={formatDate(snapshot.billingCycleStart)}
            />
            <MetricRow
              label="End"
              value={formatDate(snapshot.billingCycleEnd)}
            />
            <MetricRow
              label="Resets in"
              value={
                snapshot.daysUntilReset === null
                  ? "—"
                  : `${snapshot.daysUntilReset} day${
                      snapshot.daysUntilReset === 1 ? "" : "s"
                    }`
              }
            />
          </div>

          <p className="footer-meta">
            Updated {formatTime(snapshot.fetchedAt)}
          </p>
        </>
      )}
    </section>
  );
}
