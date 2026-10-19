import {
  battery,
  cpu,
  cpuTemperature,
  currentLoad,
  fsSize,
  graphics,
  mem,
  networkInterfaces,
  networkStats,
  osInfo,
  processes,
} from "systeminformation";
import os from "node:os";
import { MonitorCollector, type MonitorSource } from "./collector.ts";
import { selectIfaceNames, type MonitorSnapshot } from "./model.ts";

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
    // Optional native readers (macos-temperature-sensor, osx-temperature-sensor)
    // are not bundled. Apple silicon otherwise returns an empty reading.
    const info = await cpuTemperature();
    return {
      mainC: finiteOrNull(info.main),
      maxC: finiteOrNull(info.max),
      chipsetC: finiteOrNull(info.chipset),
    };
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

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
