import {
  battery,
  cpu,
  currentLoad,
  fsSize,
  graphics,
  mem,
  networkInterfaces,
  networkStats,
  osInfo,
  processes,
} from "systeminformation";
import { createRequire } from "node:module";
import os from "node:os";
import { MonitorCollector, type MonitorSource } from "./collector.ts";
import { selectIfaceNames, type FanRaw, type MonitorSnapshot, type TemperatureRaw } from "./model.ts";
import type {
  FanReading as AppleFan,
  TemperatureReading as AppleTemperature,
} from "macos-temperature-sensor";

const require = createRequire(import.meta.url);

const NIC_TTL_MS = 30_000;

let nicCache: { at: number; names: string[] } | null = null;

const systemInformationSource: MonitorSource = {
  loadavg: () => {
    const [one, five, fifteen] = os.loadavg();
    return [one ?? 0, five ?? 0, fifteen ?? 0];
  },
  uptime: () => os.uptime(),
  async host() {
    const [info, processor] = await Promise.all([osInfo(), cpu()]);
    return {
      hostname: info.hostname,
      distro: info.distro,
      release: info.release,
      arch: info.arch,
      cpu: processor.brand,
      cores: processor.physicalCores || processor.cores,
      threads: processor.cores,
      performanceCores: processor.performanceCores ?? null,
      efficiencyCores: processor.efficiencyCores ?? null,
    };
  },
  async currentLoad() {
    const load = await currentLoad();
    return {
      percent: load.currentLoad,
      user: load.currentLoadUser,
      system: load.currentLoadSystem,
      cores: load.cpus.map((item) => item.load),
    };
  },
  async memory() {
    const info = await mem();
    return {
      totalBytes: info.total,
      usedBytes: info.used,
      activeBytes: info.active,
      availableBytes: info.available,
      cacheBytes: info.buffcache,
      swapTotalBytes: info.swaptotal,
      swapUsedBytes: info.swapused,
    };
  },
  async disks() {
    const volumes = await fsSize();
    return volumes.map((volume) => ({
      fs: volume.fs,
      type: volume.type,
      mount: volume.mount,
      sizeBytes: volume.size,
      usedBytes: volume.used,
    }));
  },
  async network() {
    const names = await ifaceNames();
    const stats = names.length > 0 ? await networkStats(names.join(",")) : await networkStats();
    return stats.map((item) => ({
      name: item.iface,
      operstate: item.operstate,
      rxBytesPerSec: finiteOrNull(item.rx_sec),
      txBytesPerSec: finiteOrNull(item.tx_sec),
    }));
  },
  async battery() {
    const info = await battery();
    return {
      hasBattery: info.hasBattery,
      percent: info.percent,
      charging: info.isCharging,
      acConnected: info.acConnected,
      timeRemainingMin: typeof info.timeRemaining === "number" ? info.timeRemaining : null,
    };
  },
  async temperature() {
    const sample = await appleSensors();
    return sample.temperature;
  },
  async fans() {
    const sample = await appleSensors();
    return sample.fans;
  },
  async graphics() {
    const info = await graphics();
    return info.controllers.map((controller) => ({
      model: controller.model || controller.name || "",
      cores: controller.cores ?? null,
      vramMB: controller.vram,
      shared: controller.vramDynamic,
      temperatureC: finiteOrNull(controller.temperatureGpu),
      utilization: finiteOrNull(controller.utilizationGpu),
    }));
  },
  async processes() {
    const info = await processes();
    return {
      all: info.all,
      running: info.running,
      list: info.list.map((item) => ({
        pid: item.pid,
        name: item.name,
        cpuPercent: item.cpu,
        memPercent: item.mem,
        memRssBytes: rssBytes(item.memRss),
        executablePath: executablePath(item.path, item.command),
      })),
    };
  },
};

const collector = new MonitorCollector(systemInformationSource);

export function collectMonitor(): Promise<MonitorSnapshot> {
  return collector.collect();
}

async function ifaceNames(): Promise<string[]> {
  const now = Date.now();
  if (nicCache && now - nicCache.at < NIC_TTL_MS) {
    return nicCache.names;
  }
  try {
    const listed = await networkInterfaces();
    const nics = (Array.isArray(listed) ? listed : [listed]).map((nic) => ({
      name: nic.iface,
      internal: nic.internal,
      isDefault: nic.default,
      operstate: nic.operstate,
    }));
    const names = selectIfaceNames(nics);
    nicCache = { at: now, names };
    return names;
  } catch (error) {
    if (nicCache) {
      return nicCache.names;
    }
    throw error;
  }
}

interface AppleSensors {
  temperature(): AppleTemperature;
  fans(): AppleFan[];
}

interface SensorSnapshot {
  temperature: TemperatureRaw;
  fans: FanRaw[];
}

let pendingSensors: Promise<SensorSnapshot> | null = null;

function appleSensors(): Promise<SensorSnapshot> {
  if (pendingSensors) {
    return pendingSensors;
  }
  const run = Promise.resolve().then(readAppleSensors);
  pendingSensors = run;
  void run.finally(() => {
    if (pendingSensors === run) {
      pendingSensors = null;
    }
  });
  return run;
}

function readAppleSensors(): SensorSnapshot {
  const empty: SensorSnapshot = {
    temperature: { mainC: null, maxC: null, chipsetC: null, gpuC: null },
    fans: [],
  };
  if (process.platform !== "darwin") {
    return empty;
  }
  try {
    const sensors = require("macos-temperature-sensor") as AppleSensors;
    const reading = sensors.temperature();
    return {
      temperature: {
        mainC: finiteOrNull(reading.cpu),
        maxC: finiteOrNull(reading.cpu),
        chipsetC: finiteOrNull(reading.soc),
        gpuC: finiteOrNull(reading.gpu),
      },
      fans: sensors.fans().map((fan) => ({
        label: fan.label,
        rpm: fan.rpm,
        minRpm: fan.min,
        maxRpm: fan.max,
      })),
    };
  } catch {
    return empty;
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ps reports rss in kilobytes on macOS and Linux. systeminformation keeps that unit.
function rssBytes(kilobytes: number): number {
  if (!Number.isFinite(kilobytes) || kilobytes <= 0) {
    return 0;
  }
  return kilobytes * 1024;
}

function executablePath(directory: string, command: string): string {
  const folder = directory.trim().replace(/\/+$/, "");
  if (!folder) {
    return "";
  }
  let binary = command.trim();
  const flag = binary.search(/\s--?\S/);
  if (flag > 0) {
    binary = binary.slice(0, flag).trim();
  }
  if (!binary || binary.includes("\0")) {
    return "";
  }
  return `${folder}/${binary}`;
}
