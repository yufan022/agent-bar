import assert from "node:assert/strict";
import test from "node:test";
import { MonitorCollector, type MonitorSource } from "./collector.ts";
import {
  formatBytes,
  formatCount,
  formatRate,
  formatRpm,
  formatUptime,
  normalizeMonitor,
  batteryTone,
  pushTrace,
  selectIfaceNames,
  type BatteryRaw,
  type DiskRaw,
  type MonitorProbe,
  type ProcessRaw,
} from "./model.ts";

function probe(partial: Partial<MonitorProbe>): MonitorProbe {
  return {
    sampledAt: "2026-10-19T02:00:00.000Z",
    load: [0.2, 0.3, 0.4],
    uptimeSec: 100,
    host: null,
    cpu: null,
    memory: null,
    disks: [],
    network: [],
    battery: null,
    temperature: null,
    fans: [],
    gpus: [],
    processes: null,
    warnings: [],
    ...partial,
  };
}

function source(overrides: Partial<MonitorSource> = {}): MonitorSource {
  return {
    loadavg: () => [1.25, 1.5, 1.75],
    uptime: () => 90_061,
    host: async () => ({
      hostname: "mbp",
      distro: "macOS",
      release: "15.1",
      arch: "arm64",
      cpu: "M1 Pro",
      cores: 10,
      threads: 10,
      performanceCores: 8,
      efficiencyCores: 2,
    }),
    currentLoad: async () => ({ percent: 12.4, user: 8, system: 4, cores: [10, 20] }),
    memory: async () => ({
      totalBytes: 1000,
      usedBytes: 900,
      activeBytes: 400,
      availableBytes: 600,
      cacheBytes: 500,
      swapTotalBytes: 100,
      swapUsedBytes: 25,
    }),
    disks: async () => [],
    network: async () => [],
    battery: async () => ({
      hasBattery: false,
      percent: 0,
      charging: false,
      acConnected: true,
      timeRemainingMin: null,
    }),
    temperature: async () => ({ mainC: null, maxC: null, chipsetC: null, gpuC: null }),
    fans: async () => [],
    graphics: async () => [],
    processes: async () => ({ all: 0, running: 0, list: [] }),
    ...overrides,
  };
}

test("startup disk prefers the data volume over the sealed system snapshot", () => {
  const disks: DiskRaw[] = [
    { fs: "/dev/disk3s3s1", type: "APFS", mount: "/", sizeBytes: 1000, usedBytes: 100 },
    { fs: "/dev/disk3s6", type: "APFS", mount: "/System/Volumes/VM", sizeBytes: 1000, usedBytes: 20 },
    { fs: "/dev/disk3s1", type: "APFS", mount: "/System/Volumes/Data", sizeBytes: 1000, usedBytes: 740 },
    { fs: "/dev/disk3s5", type: "APFS", mount: "/Volumes/Recovery", sizeBytes: 1000, usedBytes: 12 },
    { fs: "devfs", type: "devfs", mount: "/dev", sizeBytes: 0, usedBytes: 0 },
    { fs: "orb", type: "NFS", mount: "/Users/someone/OrbStack", sizeBytes: 500, usedBytes: 40 },
  ];
  const snapshot = normalizeMonitor(probe({ disks }));
  assert.deepEqual(
    snapshot.disks.map((disk) => disk.label),
    ["Startup disk", "OrbStack"],
  );
  assert.equal(snapshot.disks[0]?.percent, 74);
  assert.equal(snapshot.disks[0]?.mount, "/System/Volumes/Data");
  assert.equal(snapshot.disks[1]?.type, "NFS");
});

test("memory percent uses memory in use, not file cache", () => {
  const snapshot = normalizeMonitor(
    probe({
      memory: {
        totalBytes: 1000,
        usedBytes: 900,
        activeBytes: 400,
        availableBytes: 600,
        cacheBytes: 500,
        swapTotalBytes: 200,
        swapUsedBytes: 50,
      },
    }),
  );
  assert.equal(snapshot.memory?.percent, 40);
  assert.equal(snapshot.memory?.usedBytes, 400);
  assert.equal(snapshot.memory?.swapPercent, 25);
});

test("process rows keep the executable name and drop arguments", () => {
  const processes: ProcessRaw = {
    all: 3,
    running: 1,
    list: [
      {
        pid: 10,
        name: "/usr/bin/curl --header Authorization secret-value",
        cpuPercent: 1,
        memPercent: 0.2,
        memRssBytes: 1024,
        executablePath: "",
      },
      {
        pid: 11,
        name: "Google Chrome Helper",
        cpuPercent: 40,
        memPercent: 3,
        memRssBytes: 2048,
        executablePath: "",
      },
      { pid: 0, name: "kernel", cpuPercent: 99, memPercent: 1, memRssBytes: 4096, executablePath: "" },
    ],
  };
  const snapshot = normalizeMonitor(probe({ processes }));
  assert.equal(snapshot.processes?.top[0]?.name, "Google Chrome Helper");
  assert.equal(snapshot.processes?.top[1]?.name, "curl");
  assert.equal(JSON.stringify(snapshot).includes("secret-value"), false);
  assert.equal(JSON.stringify(snapshot).includes("Authorization"), false);
});

test("applications sum resident memory inside one app bundle", () => {
  const processes: ProcessRaw = {
    all: 5,
    running: 2,
    list: [
      {
        pid: 20,
        name: "Google Chrome Helper",
        cpuPercent: 4,
        memPercent: 2,
        memRssBytes: 500,
        executablePath:
          "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper",
      },
      {
        pid: 21,
        name: "Google Chrome",
        cpuPercent: 1,
        memPercent: 1,
        memRssBytes: 300,
        executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        pid: 22,
        name: "npm exec package@latest --token secret-value",
        cpuPercent: 0,
        memPercent: 0.1,
        memRssBytes: 100,
        executablePath: "",
      },
      {
        pid: 23,
        name: "Raycast Backend",
        cpuPercent: 9,
        memPercent: 1,
        memRssBytes: 40,
        executablePath: "",
      },
      {
        pid: 25,
        name: "helper",
        cpuPercent: 0,
        memPercent: 0,
        memRssBytes: 50,
        executablePath: "/Applications/Secret.app/Contents/secret-value/helper",
      },
      {
        pid: 24,
        name: "idle",
        cpuPercent: 80,
        memPercent: 0,
        memRssBytes: 0,
        executablePath: "",
      },
    ],
  };
  const snapshot = normalizeMonitor(
    probe({
      memory: {
        totalBytes: 1000,
        usedBytes: 800,
        activeBytes: 800,
        availableBytes: 200,
        cacheBytes: 0,
        swapTotalBytes: 0,
        swapUsedBytes: 0,
      },
      processes,
    }),
  );
  assert.deepEqual(
    snapshot.processes?.apps.map((app) => [app.name, app.bytes, app.processes, app.percent]),
    [
      ["Google Chrome", 800, 2, 80],
      ["npm", 100, 1, 10],
      ["Secret", 50, 1, 5],
      ["Raycast Backend", 40, 1, 4],
    ],
  );
  assert.equal(snapshot.processes?.top[0]?.name, "idle");
  const encoded = JSON.stringify(snapshot);
  assert.equal(encoded.includes("secret-value"), false);
  assert.equal(snapshot.processes?.apps.some((app) => app.name.includes("package@latest")), false);
});

test("battery sentinel and missing sensors stay empty", () => {
  const battery: BatteryRaw = {
    hasBattery: true,
    percent: 80,
    charging: false,
    acConnected: true,
    timeRemainingMin: 65_535,
  };
  const onPower = normalizeMonitor(probe({ battery }));
  assert.equal(onPower.battery?.percent, 80);
  assert.equal(onPower.battery?.timeRemainingMin, null);
  assert.equal(batteryTone(80), "ok");
  assert.equal(batteryTone(20), "warn");
  assert.equal(batteryTone(10), "critical");
  const hot = normalizeMonitor(
    probe({
      temperature: { mainC: 0, maxC: -1, chipsetC: null },
      gpus: [{ model: "Apple M1 Pro", cores: "16", vramMB: null, shared: true, temperatureC: null, utilization: null }],
    }),
  );
  assert.equal(hot.temperature, null);
  assert.equal(hot.gpus[0]?.cores, 16);
  assert.equal(hot.gpus[0]?.vramBytes, null);
});

test("iface selection keeps the default tunnel and active ethernet", () => {
  const names = selectIfaceNames([
    { name: "lo0", internal: true, isDefault: false, operstate: "unknown" },
    { name: "awdl0", internal: false, isDefault: false, operstate: "up" },
    { name: "en1", internal: false, isDefault: false, operstate: "down" },
    { name: "en0", internal: false, isDefault: false, operstate: "up" },
    { name: "utun4", internal: false, isDefault: true, operstate: "unknown" },
    { name: "en0;reboot", internal: false, isDefault: true, operstate: "up" },
    { name: "bridge0", internal: false, isDefault: false, operstate: "up" },
  ]);
  assert.deepEqual(names, ["utun4", "en0"]);
});

test("byte and uptime formatting stay unit-stable", () => {
  assert.equal(formatBytes(0), "0\u00a0B");
  assert.match(formatBytes(1024), /\u00a0KB$/);
  assert.equal(formatBytes(-1), "—");
  assert.equal(formatRate(null), "Measuring…");
  assert.equal(formatUptime(90_061), "1d 1h");
  assert.equal(formatRpm(1523.6), `${formatCount(1523.6)}\u00a0rpm`);
  assert.equal(formatRpm(-1), "—");
});

test("temperature and fans keep live sensor readings", () => {
  const snapshot = normalizeMonitor(
    probe({
      temperature: { mainC: 50.7, maxC: 50.7, chipsetC: 49.4, gpuC: 53.2 },
      fans: [
        { label: "Fan 1", rpm: 2319, minRpm: 2317, maxRpm: 7826 },
        { label: " \n ", rpm: 10, minRpm: null, maxRpm: null },
        { label: "Fan 2", rpm: -1, minRpm: 0, maxRpm: 100 },
      ],
    }),
  );
  assert.equal(snapshot.temperature?.mainC, 50.7);
  assert.equal(snapshot.temperature?.chipsetC, 49.4);
  assert.equal(snapshot.temperature?.gpuC, 53.2);
  assert.equal(snapshot.fans.length, 2);
  assert.equal(snapshot.fans[0]?.label, "Fan 1");
  assert.equal(snapshot.fans[0]?.percent, ((2319 - 2317) / (7826 - 2317)) * 100);
  assert.equal(snapshot.fans[1]?.label, "Fan 2");
  assert.equal(snapshot.fans[1]?.percent, null);
  assert.equal(snapshot.fans[1]?.rpm, 10);
});

test("trace history drops the oldest sample at the limit", () => {
  let history = pushTrace([], { cpu: 1, memory: 1 }, 2);
  history = pushTrace(history, { cpu: 2, memory: 2 }, 2);
  history = pushTrace(history, { cpu: 3, memory: 3 }, 2);
  assert.deepEqual(history, [
    { cpu: 2, memory: 2 },
    { cpu: 3, memory: 3 },
  ]);
});

test("collector caches slow probes and refreshes them on their own clocks", async () => {
  let now = 10_000;
  let graphics = 0;
  let processes = 0;
  const collector = new MonitorCollector(
    source({
      graphics: async () => {
        graphics += 1;
        return [{ model: "GPU", cores: 8, vramMB: 1024, shared: false, temperatureC: null, utilization: null }];
      },
      processes: async () => {
        processes += 1;
        return { all: 4, running: 1, list: [] };
      },
    }),
    () => now,
  );
  await collector.collect();
  await collector.collect();
  assert.equal(graphics, 1);
  assert.equal(processes, 1);
  now += 5_000;
  await collector.collect();
  assert.equal(graphics, 1);
  assert.equal(processes, 2);
  now += 8_000;
  const snapshot = await collector.collect();
  assert.equal(graphics, 2);
  assert.equal(snapshot.gpus[0]?.model, "GPU");
  assert.equal(snapshot.memory?.percent, 40);
  assert.equal(snapshot.host?.os, "macOS 15.1");
});

test("collector keeps the previous reading when a later probe fails", async () => {
  let now = 10_000;
  let fail = false;
  const collector = new MonitorCollector(
    source({
      graphics: async () => {
        if (fail) {
          throw new Error("HTTP 401 Bearer secret-token-value");
        }
        return [{ model: "GPU", cores: 1, vramMB: null, shared: true, temperatureC: null, utilization: null }];
      },
    }),
    () => now,
  );
  await collector.collect();
  fail = true;
  now += 20_000;
  const snapshot = await collector.collect();
  assert.equal(snapshot.gpus[0]?.model, "GPU");
  assert.match(snapshot.warnings.join(" "), /Bearer \[redacted\]/);
  assert.equal(snapshot.warnings.some((warning) => warning.includes("secret-token-value")), false);
});

test("collector shares one in-flight sample", async () => {
  let started = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const collector = new MonitorCollector(
    source({
      memory: () => {
        started += 1;
        return gate.then(() => ({
          totalBytes: 1000,
          usedBytes: 100,
          activeBytes: 100,
          availableBytes: 900,
          cacheBytes: 0,
          swapTotalBytes: 0,
          swapUsedBytes: 0,
        }));
      },
    }),
  );
  const first = collector.collect();
  const second = collector.collect();
  assert.equal(first, second);
  assert.equal(started, 1);
  release();
  await first;
});

test("collector reports a still-reading warning when a probe stalls", async () => {
  const collector = new MonitorCollector(
    source({
      graphics: () => new Promise(() => {}),
    }),
    () => 5_000,
    20,
  );
  const snapshot = await collector.collect();
  assert.equal(snapshot.gpus.length, 0);
  assert.match(snapshot.warnings.join(" "), /Still reading graphics/);
  assert.equal(snapshot.cpu?.percent, 12.4);
});
