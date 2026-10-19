import {
  normalizeMonitor,
  type BatteryRaw,
  type CpuRaw,
  type DiskRaw,
  type GpuRaw,
  type HostRaw,
  type MemoryRaw,
  type MonitorSnapshot,
  type FanRaw,
  type NetworkRaw,
  type ProcessRaw,
  type TemperatureRaw,
} from "./model.ts";

export interface MonitorSource {
  loadavg(): readonly [number, number, number];
  uptime(): number;
  host(): Promise<HostRaw>;
  currentLoad(): Promise<CpuRaw>;
  memory(): Promise<MemoryRaw>;
  disks(): Promise<DiskRaw[]>;
  network(): Promise<NetworkRaw[]>;
  battery(): Promise<BatteryRaw>;
  temperature(): Promise<TemperatureRaw>;
  fans(): Promise<FanRaw[]>;
  graphics(): Promise<GpuRaw[]>;
  processes(): Promise<ProcessRaw>;
}

const HOST_TTL_MS = 60 * 60 * 1000;
const DISK_TTL_MS = 12_000;
const GRAPHICS_TTL_MS = 12_000;
const PROCESS_TTL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export class MonitorCollector {
  private readonly source: MonitorSource;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly hostCache = new TtlCache<HostRaw>(HOST_TTL_MS);
  private readonly diskCache = new TtlCache<DiskRaw[]>(DISK_TTL_MS);
  private readonly gpuCache = new TtlCache<GpuRaw[]>(GRAPHICS_TTL_MS);
  private readonly processCache = new TtlCache<ProcessRaw>(PROCESS_TTL_MS);
  private inflight: Promise<MonitorSnapshot> | null = null;

  constructor(source: MonitorSource, now: () => number = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.source = source;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  collect(): Promise<MonitorSnapshot> {
    if (this.inflight) {
      return this.inflight;
    }
    const run = this.collectOnce().finally(() => {
      if (this.inflight === run) {
        this.inflight = null;
      }
    });
    this.inflight = run;
    return run;
  }

  private async collectOnce(): Promise<MonitorSnapshot> {
    const now = this.now();
    const warnings: string[] = [];
    let load: [number, number, number] = [0, 0, 0];
    let uptimeSec = 0;
    try {
      const values = this.source.loadavg();
      load = [values[0], values[1], values[2]];
      uptimeSec = this.source.uptime();
    } catch (error) {
      warnings.push(probeWarning("Load", error));
    }

    const [host, cpu, memory, disks, network, battery, temperature, fans, gpus, processes] =
      await Promise.all([
        this.cached(this.hostCache, now, () => this.source.host(), "System", null, warnings),
        this.live(() => this.source.currentLoad(), "Processor", null, warnings),
        this.live(() => this.source.memory(), "Memory", null, warnings),
        this.cached(this.diskCache, now, () => this.source.disks(), "Disks", [], warnings),
        this.live(() => this.source.network(), "Network", [], warnings),
        this.live(() => this.source.battery(), "Battery", null, warnings),
        this.live(() => this.source.temperature(), "Temperature", null, warnings),
        this.live(() => this.source.fans(), "Fans", [], warnings),
        this.cached(this.gpuCache, now, () => this.source.graphics(), "Graphics", [], warnings),
        this.cached(this.processCache, now, () => this.source.processes(), "Processes", null, warnings),
      ]);

    return normalizeMonitor({
      sampledAt: new Date(now).toISOString(),
      load,
      uptimeSec,
      host,
      cpu,
      memory,
      disks,
      network,
      battery,
      temperature,
      fans,
      gpus,
      processes,
      warnings,
    });
  }

  private async cached<T>(
    cache: TtlCache<T>,
    now: number,
    load: () => Promise<T>,
    label: string,
    fallback: T,
    warnings: string[],
  ): Promise<T> {
    const hit = cache.fresh(now);
    if (hit.hit) {
      return hit.value;
    }
    try {
      const value = await withTimeout(load(), this.timeoutMs, label);
      cache.store(now, value);
      return value;
    } catch (error) {
      warnings.push(
        error instanceof ProbeTimeout
          ? `Still reading ${label.toLowerCase()}.`
          : probeWarning(label, error),
      );
      const stale = cache.stale();
      return stale.hit ? stale.value : fallback;
    }
  }

  private async live<T>(
    load: () => Promise<T>,
    label: string,
    fallback: T,
    warnings: string[],
  ): Promise<T> {
    try {
      return await withTimeout(load(), this.timeoutMs, label);
    } catch (error) {
      warnings.push(
        error instanceof ProbeTimeout
          ? `Still reading ${label.toLowerCase()}.`
          : probeWarning(label, error),
      );
      return fallback;
    }
  }
}

class TtlCache<T> {
  private entry: { at: number; value: T } | null = null;
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  fresh(now: number): { hit: true; value: T } | { hit: false } {
    if (!this.entry || now - this.entry.at >= this.ttlMs) {
      return { hit: false };
    }
    return { hit: true, value: this.entry.value };
  }

  stale(): { hit: true; value: T } | { hit: false } {
    if (!this.entry) {
      return { hit: false };
    }
    return { hit: true, value: this.entry.value };
  }

  store(now: number, value: T): void {
    this.entry = { at: now, value };
  }
}

class ProbeTimeout extends Error {
  constructor(label: string) {
    super(`${label} timed out`);
    this.name = "ProbeTimeout";
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ProbeTimeout(label));
    }, ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function probeWarning(label: string, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const single = raw.replace(/\s+/g, " ").trim();
  const redacted = single.replace(/bearer\s+\S+/gi, "Bearer [redacted]");
  if (!redacted) {
    return `${label} failed`;
  }
  const clipped = redacted.length > 140 ? `${redacted.slice(0, 139)}…` : redacted;
  return `${label}: ${clipped}`;
}
