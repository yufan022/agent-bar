import { useEffect, useState, type ReactNode } from "react";
import { monitorSample } from "../api";
import {
  batteryStatus,
  batteryTone,
  formatBytes,
  formatBytesPair,
  formatCores,
  formatCount,
  formatIops,
  formatLoad,
  formatPercent,
  formatPrecisePercent,
  formatRate,
  formatRpm,
  formatSampleTime,
  formatTemperature,
  formatUptime,
  MONITOR_POLL_MS,
  MONITOR_TRACE_LIMIT,
  percentTone,
  pushTrace,
  type BatteryReading,
  type CpuReading,
  type DiskActivity,
  type DiskVolume,
  type FanReading,
  type GpuInfo,
  type HostInfo,
  type MemoryReading,
  type MonitorSnapshot,
  type NetworkIface,
  type AppMemoryRow,
  type ProcessReading,
  type TemperatureReading,
  type TraceSample,
} from "../../lib/monitor/model.ts";

function messageFrom(error: unknown): string {
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "The sample failed.";
}

export function MonitorPanel() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [history, setHistory] = useState<TraceSample[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer = 0;

    const tick = async () => {
      if (stopped) {
        return;
      }
      const started = Date.now();
      try {
        const next = await monitorSample();
        if (stopped) {
          return;
        }
        setSnapshot(next);
        setError(null);
        setHistory((current) =>
          pushTrace(
            current,
            {
              cpu: next.cpu?.percent ?? null,
              memory: next.memory?.percent ?? null,
            },
            MONITOR_TRACE_LIMIT,
          ),
        );
      } catch (err) {
        if (!stopped) {
          setError(messageFrom(err));
        }
      }
      if (stopped || document.hidden) {
        return;
      }
      const wait = Math.max(250, MONITOR_POLL_MS - (Date.now() - started));
      timer = window.setTimeout(() => {
        void tick();
      }, wait);
    };

    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) {
        void tick();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="monitor" aria-busy={snapshot === null && error === null}>
      {error ? (
        <p className="error-text" role="alert">
          {snapshot
            ? `The latest sample failed. Showing the previous reading. ${error}`
            : `Couldn’t read this Mac. ${error}`}
        </p>
      ) : null}
      {snapshot === null && error === null ? (
        <p className="muted" role="status">
          Reading this Mac…
        </p>
      ) : null}
      {snapshot ? <MonitorBody snapshot={snapshot} history={history} /> : null}
    </div>
  );
}

function MonitorBody({
  snapshot,
  history,
}: {
  snapshot: MonitorSnapshot;
  history: TraceSample[];
}) {
  return (
    <>
      <HostLine host={snapshot.host} />
      <div className="monitor-pair">
        <section className="card">
          <Trace
            title="Processor"
            value={snapshot.cpu?.percent ?? null}
            series={history.map((sample) => sample.cpu)}
            stroke="monitor-spark-cpu"
            detail={snapshot.host?.cpu ?? ""}
            extra={snapshot.host ? formatCores(snapshot.host) : ""}
          >
            {snapshot.cpu && snapshot.cpu.cores.length > 0 ? <CoreStrip cpu={snapshot.cpu} /> : null}
          </Trace>
        </section>
        <section className="card">
          <Trace
            title="Memory"
            value={snapshot.memory?.percent ?? null}
            series={history.map((sample) => sample.memory)}
            stroke="monitor-spark-memory"
            detail={memoryDetail(snapshot.memory)}
            extra={cacheDetail(snapshot.memory)}
          >
            {snapshot.memory && snapshot.memory.swapTotalBytes > 0 ? (
              <div className="monitor-swap">
                <div className="metric-row">
                  <span>Swap</span>
                  <strong>
                    {formatBytesPair(snapshot.memory.swapUsedBytes, snapshot.memory.swapTotalBytes)}
                  </strong>
                </div>
                <Meter label="Swap" value={snapshot.memory.swapPercent} />
              </div>
            ) : null}
          </Trace>
        </section>
      </div>

      <div className="monitor-pair">
        <TemperatureCard temperature={snapshot.temperature} fans={snapshot.fans} />
        <GraphicsCard gpus={snapshot.gpus} />
      </div>

      <div className="monitor-pair">
        <section className="card" aria-labelledby="monitor-load">
          <h2 id="monitor-load">Load</h2>
          <dl className="monitor-load">
            <div>
              <dt>1 min</dt>
              <dd>{formatLoad(snapshot.load.one)}</dd>
            </div>
            <div>
              <dt>5 min</dt>
              <dd>{formatLoad(snapshot.load.five)}</dd>
            </div>
            <div>
              <dt>15 min</dt>
              <dd>{formatLoad(snapshot.load.fifteen)}</dd>
            </div>
          </dl>
        </section>
        {snapshot.battery ? <BatteryCard battery={snapshot.battery} /> : null}
      </div>

      <div className="monitor-pair">
        <section className="card" aria-labelledby="monitor-disks">
          <h2 id="monitor-disks">Disks</h2>
          <DiskList disks={snapshot.disks} activity={snapshot.diskActivity} />
        </section>
        <section className="card" aria-labelledby="monitor-network">
          <h2 id="monitor-network">Network</h2>
          <NetworkList ifaces={snapshot.network} />
        </section>
      </div>

      <div className="monitor-pair">
        <section className="card" aria-labelledby="monitor-apps">
          <h2 id="monitor-apps">Applications</h2>
          <AppMemory apps={snapshot.processes?.apps ?? null} />
        </section>
        <section className="card" aria-labelledby="monitor-processes">
          <h2 id="monitor-processes">Processes</h2>
          <ProcessList processes={snapshot.processes} />
        </section>
      </div>

      {snapshot.warnings.length > 0 ? (
        <p className="monitor-warning">{snapshot.warnings.join(" ")}</p>
      ) : null}
      <p className="footer-meta">Sampled {formatSampleTime(snapshot.sampledAt)}</p>
    </>
  );
}

function HostLine({ host }: { host: HostInfo | null }) {
  if (!host) {
    return <p className="monitor-host muted">Reading system details…</p>;
  }
  const parts = [host.os, host.arch, `up ${formatUptime(host.uptimeSec)}`].filter(Boolean);
  return (
    <p className="monitor-host muted">
      <span translate="no">{host.hostname}</span>
      {parts.length > 0 ? `, ${parts.join(", ")}` : ""}
    </p>
  );
}

function Trace({
  title,
  value,
  series,
  stroke,
  detail,
  extra,
  children,
}: {
  title: string;
  value: number | null;
  series: Array<number | null>;
  stroke: string;
  detail: string;
  extra: string;
  children?: ReactNode;
}) {
  const tone = percentTone(value);
  return (
    <div className="monitor-trace">
      <header className="card-header">
        <h2>{title}</h2>
        <strong className={tone === "ok" ? "monitor-figure" : `monitor-figure monitor-tone-${tone}`}>
          {formatPercent(value)}
        </strong>
      </header>
      {detail ? (
        <p className="muted" translate="no">
          {detail}
        </p>
      ) : null}
      {extra ? <p className="muted">{extra}</p> : null}
      <Sparkline
        values={series}
        className={stroke}
        label={`${title} history, now ${formatPercent(value)}`}
      />
      {children}
    </div>
  );
}

function CoreStrip({ cpu }: { cpu: CpuReading }) {
  const busiest = Math.max(...cpu.cores);
  return (
    <div
      className="monitor-cores"
      role="img"
      aria-label={`${formatCount(cpu.cores.length)} cores, busiest ${formatPercent(busiest)}`}
    >
      {cpu.cores.map((value, index) => (
        <div key={index} className="monitor-core">
          <span
            className={value >= 90 ? "monitor-core-hot" : undefined}
            style={{ height: `${Math.max(0, Math.min(100, value))}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function BatteryCard({ battery }: { battery: BatteryReading }) {
  return (
    <section className="card" aria-labelledby="monitor-battery">
      <header className="card-header">
        <h2 id="monitor-battery">Battery</h2>
        <strong className="monitor-figure">{formatPercent(battery.percent)}</strong>
      </header>
      <p className="muted">{batteryStatus(battery)}</p>
      <Meter label="Battery" value={battery.percent} tone={batteryTone(battery.percent)} />
    </section>
  );
}

function TemperatureCard({
  temperature,
  fans,
}: {
  temperature: TemperatureReading | null;
  fans: FanReading[];
}) {
  const cpu = temperature?.mainC ?? temperature?.maxC ?? null;
  const soc = temperature?.chipsetC ?? null;
  const gpu = temperature?.gpuC ?? null;
  const rows = [
    cpu !== null ? { label: "CPU", value: formatTemperature(cpu) } : null,
    soc !== null ? { label: "SoC", value: formatTemperature(soc) } : null,
    gpu !== null ? { label: "GPU", value: formatTemperature(gpu) } : null,
  ].filter((row): row is { label: string; value: string } => row !== null);
  return (
    <section className="card" aria-labelledby="monitor-temperature">
      <h2 id="monitor-temperature">Temperature</h2>
      {rows.length === 0 && fans.length === 0 ? (
        <p className="muted">Temperature isn’t available in this session.</p>
      ) : (
        <>
          {rows.length > 0 ? (
            <ul className="monitor-list">
              {rows.map((row) => (
                <li key={row.label}>
                  <div className="monitor-split">
                    <span>{row.label}</span>
                    <span className="monitor-bytes">{row.value}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Temperature isn’t available in this session.</p>
          )}
          {fans.length > 0 ? (
            <ul className={rows.length > 0 ? "monitor-list monitor-fans" : "monitor-list"} aria-label="Fans">
              {fans.map((fan, index) => (
                <li key={`${fan.label}-${index}`}>
                  <div className="monitor-split">
                    <span translate="no">{fan.label}</span>
                    <span className="monitor-bytes">{formatRpm(fan.rpm)}</span>
                  </div>
                  {fan.percent !== null ? <Meter label={`${fan.label} speed`} value={fan.percent} /> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}

function GraphicsCard({ gpus }: { gpus: GpuInfo[] }) {
  return (
    <section className="card" aria-labelledby="monitor-graphics">
      <h2 id="monitor-graphics">Graphics</h2>
      {gpus.length === 0 ? (
        <p className="muted">No graphics adapter reported.</p>
      ) : (
        <ul className="monitor-list">
          {gpus.map((gpu, index) => {
            const detail = gpuDetail(gpu);
            return (
              <li key={`${gpu.model}-${index}`}>
                <span translate="no">{gpu.model}</span>
                {detail ? <span className="muted">{detail}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DiskList({ disks, activity }: { disks: DiskVolume[]; activity: DiskActivity[] }) {
  if (disks.length === 0 && activity.length === 0) {
    return <p className="muted">No local volumes reported.</p>;
  }
  return (
    <>
      {disks.length === 0 ? (
        <p className="muted">No local volumes reported.</p>
      ) : (
        <ul className="monitor-list">
          {disks.map((disk) => (
            <li key={disk.mount}>
              <div className="monitor-split">
                <span className="monitor-ellipsis">
                  {disk.label}
                  {disk.type ? <span className="muted"> {disk.type}</span> : null}
                </span>
                <span className="muted">{formatBytesPair(disk.usedBytes, disk.sizeBytes)}</span>
              </div>
              <Meter label={disk.label} value={disk.percent} />
            </li>
          ))}
        </ul>
      )}
      {activity.length > 0 ? (
        <>
          <h3 id="monitor-disk-activity" className="monitor-activity-title">
            Activity
          </h3>
          <ul className="monitor-list monitor-activity" aria-labelledby="monitor-disk-activity">
            {activity.map((disk) => (
              <li key={disk.aggregate ? "all-disks" : disk.name}>
                <span className="monitor-ellipsis" translate={disk.aggregate ? undefined : "no"}>
                  {disk.name}
                </span>
                <span className="monitor-rates">
                  <span>Read {diskActivityDetail(disk.readBytesPerSec, disk.readIops)}</span>
                  <span>Write {diskActivityDetail(disk.writeBytesPerSec, disk.writeIops)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function diskActivityDetail(bytesPerSec: number | null, iops: number | null): string {
  if (bytesPerSec === null || iops === null) {
    return "Measuring…";
  }
  return `${formatRate(bytesPerSec)} · ${formatIops(iops)}`;
}

function NetworkList({ ifaces }: { ifaces: NetworkIface[] }) {
  if (ifaces.length === 0) {
    return <p className="muted">No active interface reported.</p>;
  }
  return (
    <ul className="monitor-list monitor-stack">
      {ifaces.map((iface) => (
        <li key={iface.name}>
          <div className="monitor-split">
            <span translate="no">{iface.name}</span>
            {iface.state === "unknown" ? null : <span className="muted">{ifaceLabel(iface.state)}</span>}
          </div>
          <span className="monitor-rates">
            <span>In {formatRate(iface.rxBytesPerSec)}</span>
            <span>Out {formatRate(iface.txBytesPerSec)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AppMemory({ apps }: { apps: AppMemoryRow[] | null }) {
  if (!apps) {
    return <p className="muted">Application memory isn’t available.</p>;
  }
  if (apps.length === 0) {
    return <p className="muted">No application memory reported.</p>;
  }
  return (
    <>
      <p className="muted">Resident memory, grouped by application.</p>
      <ul className="monitor-list">
        {apps.map((app) => (
          <li key={app.name}>
            <div className="monitor-split">
              <span className="monitor-ellipsis" translate="no">
                {app.name}
              </span>
              <span className="monitor-bytes">
                {formatBytes(app.bytes)}
                {app.percent >= 0.5 ? <span className="muted"> {formatPercent(app.percent)}</span> : null}
              </span>
            </div>
            <Meter label={`${app.name} resident memory`} value={app.percent} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ProcessList({ processes }: { processes: ProcessReading | null }) {
  if (!processes) {
    return <p className="muted">Process list isn’t available.</p>;
  }
  return (
    <>
      <p className="muted">
        {formatCount(processes.all)} processes, {formatCount(processes.running)} running
      </p>
      {processes.top.length === 0 ? (
        <p className="muted">No processes reported.</p>
      ) : (
        <table className="monitor-table">
          <caption className="sr-only">Processes using the most processor</caption>
          <thead>
            <tr>
              <th scope="col">Process</th>
              <th scope="col" className="num col-pid">
                PID
              </th>
              <th scope="col" className="num col-pct">
                CPU
              </th>
              <th scope="col" className="num col-pct">
                Memory
              </th>
            </tr>
          </thead>
          <tbody>
            {processes.top.map((row) => (
              <tr key={row.pid}>
                <th scope="row" className="monitor-name" translate="no">
                  {row.name}
                </th>
                <td className="num">{formatCount(row.pid)}</td>
                <td className="num">{formatPrecisePercent(row.cpuPercent)}</td>
                <td className="num">{formatPrecisePercent(row.memPercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Sparkline({
  values,
  label,
  className,
}: {
  values: Array<number | null>;
  label: string;
  className: string;
}) {
  const width = 160;
  const height = 36;
  const finite = values.map((value) =>
    value === null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value)),
  );
  let path = "";
  if (finite.length > 1) {
    const step = width / (finite.length - 1);
    finite.forEach((value, index) => {
      if (value === null) {
        return;
      }
      const x = index * step;
      const y = height - (value / 100) * (height - 2) - 1;
      const command = path === "" || finite[index - 1] === null ? "M" : "L";
      path += `${command}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
  }
  return (
    <svg
      className={`monitor-spark ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      {path ? (
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}

function Meter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | null;
  tone?: "ok" | "warn" | "critical";
}) {
  const resolved = tone ?? percentTone(value);
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      className="progress-track"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={formatPercent(value)}
    >
      <div className={`progress-fill progress-${resolved}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function memoryDetail(memory: MemoryReading | null): string {
  if (!memory) {
    return "";
  }
  return `${formatBytes(memory.usedBytes)} in use, ${formatBytes(memory.availableBytes)} available`;
}

function cacheDetail(memory: MemoryReading | null): string {
  if (!memory || memory.cacheBytes <= 0) {
    return "";
  }
  return `File cache ${formatBytes(memory.cacheBytes)}`;
}

function gpuDetail(gpu: GpuInfo): string {
  const parts: string[] = [];
  if (gpu.cores) {
    parts.push(`${formatCount(gpu.cores)} cores`);
  }
  if (gpu.vramBytes) {
    parts.push(gpu.shared ? `${formatBytes(gpu.vramBytes)} shared` : formatBytes(gpu.vramBytes));
  }
  if (gpu.utilization !== null) {
    parts.push(formatPercent(gpu.utilization));
  }
  return parts.join(", ");
}

function ifaceLabel(state: NetworkIface["state"]): string {
  if (state === "up") {
    return "Active";
  }
  if (state === "down") {
    return "Inactive";
  }
  return "Unknown";
}
