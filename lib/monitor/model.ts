export const MONITOR_POLL_MS = 2_000;
export const MONITOR_TRACE_LIMIT = 60;

const TOP_PROCESSES = 8;
const TOP_APPS = 8;
const IFACE_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;
const HIDDEN_IFACE = /^(lo|awdl|llw|anpi|ap|bridge|vmenet|nan|gif|stf|pktap|ipsec|utun|xhc)\d*$/i;
const HIDDEN_FS_TYPES = new Set(["devfs", "autofs", "devtmpfs", "map"]);

export interface TraceSample {
  cpu: number | null;
  memory: number | null;
}

export interface HostInfo {
  hostname: string;
  os: string;
  arch: string;
  cpu: string;
  cores: number;
  threads: number;
  performanceCores: number | null;
  efficiencyCores: number | null;
  uptimeSec: number;
}

export interface LoadReading {
  one: number;
  five: number;
  fifteen: number;
}

export interface CpuReading {
  percent: number;
  user: number;
  system: number;
  cores: number[];
}

export interface MemoryReading {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  cacheBytes: number;
  percent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  swapPercent: number | null;
}

export interface DiskVolume {
  mount: string;
  label: string;
  type: string;
  sizeBytes: number;
  usedBytes: number;
  percent: number;
}

export interface NetworkIface {
  name: string;
  state: "up" | "down" | "unknown";
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
}

export interface BatteryReading {
  percent: number;
  charging: boolean;
  acConnected: boolean;
  timeRemainingMin: number | null;
}

export interface TemperatureReading {
  mainC: number | null;
  maxC: number | null;
  chipsetC: number | null;
  gpuC: number | null;
}

export interface FanReading {
  label: string;
  rpm: number;
  minRpm: number | null;
  maxRpm: number | null;
  percent: number | null;
}

export interface GpuInfo {
  model: string;
  cores: number | null;
  vramBytes: number | null;
  shared: boolean;
  temperatureC: number | null;
  utilization: number | null;
}

export interface ProcessRow {
  pid: number;
  name: string;
  cpuPercent: number;
  memPercent: number;
}

export interface AppMemoryRow {
  name: string;
  bytes: number;
  percent: number;
  processes: number;
}

export interface ProcessReading {
  all: number;
  running: number;
  top: ProcessRow[];
  apps: AppMemoryRow[];
}

export interface MonitorSnapshot {
  sampledAt: string;
  host: HostInfo | null;
  load: LoadReading;
  cpu: CpuReading | null;
  memory: MemoryReading | null;
  disks: DiskVolume[];
  network: NetworkIface[];
  battery: BatteryReading | null;
  temperature: TemperatureReading | null;
  fans: FanReading[];
  gpus: GpuInfo[];
  processes: ProcessReading | null;
  warnings: string[];
}

export interface HostRaw {
  hostname: string;
  distro: string;
  release: string;
  arch: string;
  cpu: string;
  cores: number;
  threads: number;
  performanceCores: number | null;
  efficiencyCores: number | null;
}

export interface CpuRaw {
  percent: number;
  user: number;
  system: number;
  cores: number[];
}

export interface MemoryRaw {
  totalBytes: number;
  usedBytes: number;
  activeBytes: number;
  availableBytes: number;
  cacheBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface DiskRaw {
  fs: string;
  type: string;
  mount: string;
  sizeBytes: number;
  usedBytes: number;
}

export interface NetworkRaw {
  name: string;
  operstate: string;
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
}

export interface BatteryRaw {
  hasBattery: boolean;
  percent: number;
  charging: boolean;
  acConnected: boolean;
  timeRemainingMin: number | null;
}

export interface TemperatureRaw {
  mainC: number | null;
  maxC: number | null;
  chipsetC: number | null;
  gpuC?: number | null;
}

export interface FanRaw {
  label: string;
  rpm: number;
  minRpm: number | null;
  maxRpm: number | null;
}

export interface GpuRaw {
  model: string;
  cores: number | string | null;
  vramMB: number | null;
  shared: boolean;
  temperatureC: number | null;
  utilization: number | null;
}

export interface ProcessSample {
  pid: number;
  name: string;
  cpuPercent: number;
  memPercent: number;
  memRssBytes: number;
  executablePath: string;
}

export interface ProcessRaw {
  all: number;
  running: number;
  list: ProcessSample[];
}

export interface NicCandidate {
  name: string;
  internal: boolean;
  isDefault: boolean;
  operstate: string;
}

export interface MonitorProbe {
  sampledAt: string;
  load: readonly [number, number, number];
  uptimeSec: number;
  host: HostRaw | null;
  cpu: CpuRaw | null;
  memory: MemoryRaw | null;
  disks: readonly DiskRaw[];
  network: readonly NetworkRaw[];
  battery: BatteryRaw | null;
  temperature: TemperatureRaw | null;
  fans: readonly FanRaw[];
  gpus: readonly GpuRaw[];
  processes: ProcessRaw | null;
  warnings: readonly string[];
}

export function pushTrace(
  history: readonly TraceSample[],
  sample: TraceSample,
  limit = MONITOR_TRACE_LIMIT,
): TraceSample[] {
  const next = history.length >= limit ? history.slice(history.length - limit + 1) : history.slice();
  next.push(sample);
  return next;
}

export function selectIfaceNames(nics: readonly NicCandidate[], limit = 4): string[] {
  const chosen: string[] = [];
  const add = (name: string) => {
    if (chosen.length >= limit || chosen.includes(name)) {
      return;
    }
    chosen.push(name);
  };
  const safe = nics.filter((nic) => IFACE_NAME.test(nic.name) && !nic.internal);
  for (const nic of safe) {
    if (nic.isDefault && !nic.name.startsWith("lo")) {
      add(nic.name);
    }
  }
  for (const nic of safe) {
    if (HIDDEN_IFACE.test(nic.name)) {
      continue;
    }
    if (/^en\d+$/.test(nic.name) && nic.operstate === "up") {
      add(nic.name);
    }
  }
  return chosen;
}

export function normalizeMonitor(probe: MonitorProbe): MonitorSnapshot {
  return {
    sampledAt: probe.sampledAt,
    host: normalizeHost(probe.host, probe.uptimeSec),
    load: {
      one: nonNegative(probe.load[0]),
      five: nonNegative(probe.load[1]),
      fifteen: nonNegative(probe.load[2]),
    },
    cpu: normalizeCpu(probe.cpu),
    memory: normalizeMemory(probe.memory),
    disks: normalizeDisks(probe.disks),
    network: normalizeNetwork(probe.network),
    battery: normalizeBattery(probe.battery),
    temperature: normalizeTemperature(probe.temperature),
    fans: normalizeFans(probe.fans),
    gpus: normalizeGpus(probe.gpus),
    processes: normalizeProcesses(probe.processes, probe.memory?.totalBytes ?? 0),
    warnings: cleanWarnings(probe.warnings),
  };
}

export function percentTone(value: number | null): "ok" | "warn" | "critical" {
  if (value === null || value < 80) {
    return "ok";
  }
  if (value < 90) {
    return "warn";
  }
  return "critical";
}

export function batteryTone(percent: number | null): "ok" | "warn" | "critical" {
  if (percent === null) {
    return "ok";
  }
  if (percent <= 15) {
    return "critical";
  }
  if (percent <= 30) {
    return "warn";
  }
  return "ok";
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(value))}%`;
}

export function formatPrecisePercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

export function formatLoad(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${formatted}\u00a0${units[unit]}`;
}

export function formatBytesPair(used: number, total: number): string {
  return `${formatBytes(used)} of ${formatBytes(total)}`;
}

export function formatRate(bytesPerSec: number | null): string {
  if (bytesPerSec === null || !Number.isFinite(bytesPerSec)) {
    return "Measuring…";
  }
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) {
    return `${formatCount(days)}d ${formatCount(hours)}h`;
  }
  if (hours > 0) {
    return `${formatCount(hours)}h ${formatCount(minutes)}m`;
  }
  return `${formatCount(minutes)}m`;
}

export function formatTemperature(celsius: number | null): string {
  if (celsius === null || !Number.isFinite(celsius)) {
    return "—";
  }
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.round(celsius),
  );
  return `${formatted}\u00a0°C`;
}

export function formatRpm(rpm: number | null): string {
  if (rpm === null || !Number.isFinite(rpm) || rpm < 0) {
    return "—";
  }
  return `${formatCount(rpm)}\u00a0rpm`;
}

export function formatBatteryTime(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) {
    return "Time left unavailable";
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  if (hours > 0) {
    return `${formatCount(hours)}h ${formatCount(mins)}m left`;
  }
  return `${formatCount(mins)}m left`;
}

export function formatCores(host: HostInfo): string {
  if (host.performanceCores && host.efficiencyCores) {
    return `${formatCount(host.performanceCores)} performance, ${formatCount(host.efficiencyCores)} efficiency`;
  }
  if (host.threads > host.cores && host.cores > 0) {
    return `${formatCount(host.cores)} cores, ${formatCount(host.threads)} threads`;
  }
  if (host.cores > 0) {
    return `${formatCount(host.cores)} cores`;
  }
  return "";
}

export function formatSampleTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function batteryStatus(battery: BatteryReading): string {
  if (battery.charging) {
    return "Charging";
  }
  if (battery.acConnected) {
    return "On power";
  }
  return formatBatteryTime(battery.timeRemainingMin);
}

function normalizeHost(raw: HostRaw | null, uptimeSec: number): HostInfo | null {
  if (!raw) {
    return null;
  }
  const cpu = raw.cpu.trim();
  const hostname = raw.hostname.trim();
  if (!cpu && !hostname) {
    return null;
  }
  return {
    hostname: hostname || "This Mac",
    os: joinOs(raw.distro, raw.release),
    arch: raw.arch.trim(),
    cpu,
    cores: positiveInt(raw.cores),
    threads: positiveInt(raw.threads),
    performanceCores: positiveOrNull(raw.performanceCores),
    efficiencyCores: positiveOrNull(raw.efficiencyCores),
    uptimeSec: Number.isFinite(uptimeSec) && uptimeSec >= 0 ? uptimeSec : 0,
  };
}

function normalizeCpu(raw: CpuRaw | null): CpuReading | null {
  if (!raw || !Number.isFinite(raw.percent)) {
    return null;
  }
  return {
    percent: clampPercent(raw.percent),
    user: clampPercent(raw.user),
    system: clampPercent(raw.system),
    cores: raw.cores.filter((value) => Number.isFinite(value)).map((value) => clampPercent(value)),
  };
}

function normalizeMemory(raw: MemoryRaw | null): MemoryReading | null {
  if (!raw || !Number.isFinite(raw.totalBytes) || raw.totalBytes <= 0) {
    return null;
  }
  // `active` is memory in use. `used` also counts file cache and reads as almost full.
  const active = Number.isFinite(raw.activeBytes) && raw.activeBytes > 0 ? raw.activeBytes : raw.usedBytes;
  const used = Math.max(0, active);
  const swapTotal = nonNegative(raw.swapTotalBytes);
  const swapUsed = nonNegative(raw.swapUsedBytes);
  return {
    totalBytes: raw.totalBytes,
    usedBytes: used,
    availableBytes: nonNegative(raw.availableBytes),
    cacheBytes: nonNegative(raw.cacheBytes),
    percent: clampPercent((used / raw.totalBytes) * 100),
    swapTotalBytes: swapTotal,
    swapUsedBytes: swapUsed,
    swapPercent: swapTotal > 0 ? clampPercent((swapUsed / swapTotal) * 100) : null,
  };
}

function normalizeDisks(disks: readonly DiskRaw[]): DiskVolume[] {
  const candidates = disks.filter((disk) => visibleDisk(disk));
  const hasData = candidates.some((disk) => disk.mount === "/System/Volumes/Data");
  const visible = hasData ? candidates.filter((disk) => disk.mount !== "/") : candidates;
  const byKey = new Map<string, DiskRaw>();
  for (const disk of visible) {
    const key = disk.fs.trim() || disk.mount;
    const previous = byKey.get(key);
    if (!previous || mountRank(disk.mount) < mountRank(previous.mount)) {
      byKey.set(key, disk);
    }
  }
  return [...byKey.values()]
    .sort((a, b) => mountRank(a.mount) - mountRank(b.mount) || a.mount.localeCompare(b.mount))
    .map((disk) => ({
      mount: disk.mount,
      label: volumeLabel(disk.mount),
      type: disk.type.trim(),
      sizeBytes: disk.sizeBytes,
      usedBytes: nonNegative(disk.usedBytes),
      percent: clampPercent((disk.usedBytes / disk.sizeBytes) * 100),
    }));
}

function normalizeNetwork(ifaces: readonly NetworkRaw[]): NetworkIface[] {
  const seen = new Set<string>();
  const result: NetworkIface[] = [];
  for (const iface of ifaces) {
    if (!IFACE_NAME.test(iface.name) || iface.name.startsWith("lo") || seen.has(iface.name)) {
      continue;
    }
    seen.add(iface.name);
    result.push({
      name: iface.name,
      state: ifaceState(iface.operstate),
      rxBytesPerSec: rate(iface.rxBytesPerSec),
      txBytesPerSec: rate(iface.txBytesPerSec),
    });
  }
  return result;
}

function normalizeBattery(raw: BatteryRaw | null): BatteryReading | null {
  if (!raw?.hasBattery) {
    return null;
  }
  const time = raw.timeRemainingMin;
  // 65535 is the IOKit sentinel for "still calculating".
  const known =
    time !== null && Number.isFinite(time) && time >= 0 && time < 65_535 ? Math.round(time) : null;
  return {
    percent: clampPercent(raw.percent),
    charging: raw.charging,
    acConnected: raw.acConnected,
    timeRemainingMin: raw.charging || raw.acConnected ? null : known,
  };
}

function normalizeTemperature(raw: TemperatureRaw | null): TemperatureReading | null {
  if (!raw) {
    return null;
  }
  const reading = {
    mainC: celsius(raw.mainC),
    maxC: celsius(raw.maxC),
    chipsetC: celsius(raw.chipsetC),
    gpuC: celsius(raw.gpuC ?? null),
  };
  if (
    reading.mainC === null &&
    reading.maxC === null &&
    reading.chipsetC === null &&
    reading.gpuC === null
  ) {
    return null;
  }
  return reading;
}

function normalizeFans(fans: readonly FanRaw[]): FanReading[] {
  const result: FanReading[] = [];
  for (const fan of fans) {
    if (!Number.isFinite(fan.rpm) || fan.rpm < 0) {
      continue;
    }
    const minRpm = nonNegativeOrNull(fan.minRpm);
    const maxRpm = nonNegativeOrNull(fan.maxRpm);
    const boundedMax = minRpm !== null && maxRpm !== null && maxRpm < minRpm ? null : maxRpm;
    result.push({
      label: fanLabel(fan.label, result.length),
      rpm: fan.rpm,
      minRpm,
      maxRpm: boundedMax,
      percent: fanPercent(fan.rpm, minRpm, boundedMax),
    });
    if (result.length >= 6) {
      break;
    }
  }
  return result;
}

function fanLabel(raw: string, index: number): string {
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? clip(cleaned, 32) : `Fan ${index + 1}`;
}

function fanPercent(rpm: number, minRpm: number | null, maxRpm: number | null): number | null {
  if (minRpm === null || maxRpm === null || maxRpm <= minRpm) {
    return null;
  }
  return clampPercent(((rpm - minRpm) / (maxRpm - minRpm)) * 100);
}

function nonNegativeOrNull(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function normalizeGpus(gpus: readonly GpuRaw[]): GpuInfo[] {
  const result: GpuInfo[] = [];
  for (const gpu of gpus) {
    const model = gpu.model.trim();
    if (!model) {
      continue;
    }
    result.push({
      model: clip(model, 80),
      cores: count(gpu.cores),
      vramBytes: vramBytes(gpu.vramMB),
      shared: gpu.shared,
      temperatureC: celsius(gpu.temperatureC),
      utilization:
        gpu.utilization === null || !Number.isFinite(gpu.utilization)
          ? null
          : clampPercent(gpu.utilization),
    });
  }
  return result;
}

function normalizeProcesses(raw: ProcessRaw | null, totalBytes: number): ProcessReading | null {
  if (!raw) {
    return null;
  }
  const samples = raw.list.filter((item) => Number.isInteger(item.pid) && item.pid > 0);
  const top = samples
    .map((item) => ({
      pid: item.pid,
      name: processLabel(item.name),
      cpuPercent: nonNegative(item.cpuPercent),
      memPercent: clampPercent(item.memPercent),
    }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent || b.memPercent - a.memPercent || a.pid - b.pid)
    .slice(0, TOP_PROCESSES);
  return {
    all: positiveInt(raw.all),
    running: positiveInt(raw.running),
    top,
    apps: rankApplications(samples, totalBytes),
  };
}

// Sum resident memory per application. Shared pages are counted in each process,
// so a total can sit above the memory that application uniquely holds.
function rankApplications(samples: readonly ProcessSample[], totalBytes: number): AppMemoryRow[] {
  const grouped = new Map<string, { bytes: number; processes: number }>();
  for (const sample of samples) {
    const bytes = nonNegative(sample.memRssBytes);
    if (bytes <= 0) {
      continue;
    }
    const name = applicationName(sample);
    const current = grouped.get(name) ?? { bytes: 0, processes: 0 };
    current.bytes += bytes;
    current.processes += 1;
    grouped.set(name, current);
  }
  const physical = nonNegative(totalBytes);
  return [...grouped.entries()]
    .map(([name, usage]) => ({
      name,
      bytes: usage.bytes,
      processes: usage.processes,
      percent: physical > 0 ? clampPercent((usage.bytes / physical) * 100) : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, TOP_APPS);
}

function applicationName(sample: ProcessSample): string {
  const bundle = bundleName(sample.executablePath);
  if (bundle) {
    return bundle;
  }
  const label = processLabel(sample.name);
  const executable = label.split(/\s+/)[0] ?? label;
  if (executable && label.includes(" ") && executable === executable.toLowerCase()) {
    return clip(executable, 64);
  }
  return label;
}

function bundleName(executablePath: string): string | null {
  if (!executablePath) {
    return null;
  }
  const match = /\/([^/]+)\.app(?:\/|$)/.exec(executablePath);
  const name = match?.[1]?.trim() ?? "";
  return name ? clip(name, 64) : null;
}

function visibleDisk(disk: DiskRaw): boolean {
  if (!disk.mount || !Number.isFinite(disk.sizeBytes) || disk.sizeBytes <= 0) {
    return false;
  }
  if (HIDDEN_FS_TYPES.has(disk.type.trim().toLowerCase())) {
    return false;
  }
  if (disk.mount === "/System/Volumes/Data") {
    return true;
  }
  if (disk.mount === "/Volumes/Recovery" || disk.mount.startsWith("/System/Volumes/")) {
    return false;
  }
  if (disk.mount === "/dev" || disk.mount.startsWith("/dev/")) {
    return false;
  }
  if (disk.mount === "/private/var/vm" || disk.mount.startsWith("/private/var/vm/")) {
    return false;
  }
  return true;
}

function volumeLabel(mount: string): string {
  if (mount === "/" || mount === "/System/Volumes/Data") {
    return "Startup disk";
  }
  const segment = mount.split("/").filter(Boolean).pop();
  return segment || mount;
}

function mountRank(mount: string): number {
  if (mount === "/System/Volumes/Data" || mount === "/") {
    return 0;
  }
  if (mount.startsWith("/Volumes/")) {
    return 1;
  }
  return 2;
}

function ifaceState(value: string): "up" | "down" | "unknown" {
  if (value === "up") {
    return "up";
  }
  if (value === "down") {
    return "down";
  }
  return "unknown";
}

function processLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "process";
  }
  let body = trimmed;
  if (body.includes("/")) {
    const token = body.split(/\s+/).find((part) => part.includes("/")) ?? body;
    body = token.split("/").pop() ?? token;
  } else {
    const flag = body.search(/\s--?\S/);
    if (flag > 0) {
      body = body.slice(0, flag);
    }
  }
  const cleaned = body.replace(/:$/, "").trim();
  return cleaned ? clip(cleaned, 64) : "process";
}

function cleanWarnings(warnings: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const warning of warnings) {
    const text = warning.replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(clip(text, 180));
    if (result.length >= 6) {
      break;
    }
  }
  return result;
}

function joinOs(distro: string, release: string): string {
  const left = distro.trim();
  const right = release.trim();
  if (!left) {
    return right;
  }
  if (!right || left.includes(right)) {
    return left;
  }
  return `${left} ${right}`;
}

function celsius(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0 || value > 150) {
    return null;
  }
  return value;
}

function vramBytes(vramMB: number | null): number | null {
  if (vramMB === null || !Number.isFinite(vramMB) || vramMB <= 0) {
    return null;
  }
  return Math.round(vramMB * 1024 * 1024);
}

function count(value: number | string | null): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.round(parsed);
}

function rate(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

function nonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function positiveInt(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(value);
}

function positiveOrNull(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function clip(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
