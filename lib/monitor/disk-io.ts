import type { DiskIoRaw } from "./model.ts";

// Depth 2 is the storage driver plus its whole-disk IOMedia. Partitions sit deeper
// and share the driver's counters, so they are not separate disks.
export const DISK_IO_IOREG_ARGS = ["-r", "-c", "IOBlockStorageDriver", "-d", "2", "-w", "0"] as const;

const DRIVER_LINE = /^[| ]*\+-o IOBlockStorageDriver\b/;
const DRIVER_ID = /\bid (0x[0-9a-fA-F]+)\b/;
const MEDIA_LINE = /^[| ]*\+-o (.+?)\s+<class IOMedia\b/;
const STATISTICS_BODY = /"Statistics"\s*=\s*\{([^}]*)\}/;

interface PendingDisk {
  id: string;
  name: string | null;
  hasStatistics: boolean;
  readBytes: number | null;
  writeBytes: number | null;
  readOps: number | null;
  writeOps: number | null;
}

// IOBlockStorageDriver publishes cumulative byte and operation counters for one
// physical disk. APFS volumes on that disk do not get their own totals.
export function parseIoregDiskIo(text: string): DiskIoRaw[] {
  const pending: PendingDisk[] = [];
  let current: PendingDisk | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (DRIVER_LINE.test(line)) {
      current = openDriver(line);
      if (current) {
        pending.push(current);
      }
      continue;
    }
    if (!current) {
      continue;
    }
    if (!current.hasStatistics && line.includes('"Statistics"')) {
      readStatistics(line, current);
      current.hasStatistics = true;
    }
    if (!current.name) {
      const media = MEDIA_LINE.exec(line);
      const label = media?.[1] ? diskLabel(media[1]) : "";
      if (label) {
        current.name = label;
      }
    }
  }

  return uniqueDisks(pending.filter(isComplete));
}

function openDriver(line: string): PendingDisk | null {
  const id = DRIVER_ID.exec(line)?.[1]?.toLowerCase();
  if (!id) {
    return null;
  }
  return {
    id,
    name: null,
    hasStatistics: false,
    readBytes: null,
    writeBytes: null,
    readOps: null,
    writeOps: null,
  };
}

function readStatistics(line: string, disk: PendingDisk): void {
  const body = STATISTICS_BODY.exec(line)?.[1];
  if (!body) {
    return;
  }
  const pattern = /"([^"]+)"\s*=\s*(\d+)/g;
  for (const match of body.matchAll(pattern)) {
    const key = match[1];
    const raw = match[2];
    if (!key || !raw) {
      continue;
    }
    const value = readCounter(raw);
    if (value === null) {
      continue;
    }
    if (key === "Bytes (Read)") {
      disk.readBytes = value;
    } else if (key === "Bytes (Write)") {
      disk.writeBytes = value;
    } else if (key === "Operations (Read)") {
      disk.readOps = value;
    } else if (key === "Operations (Write)") {
      disk.writeOps = value;
    }
  }
}

function readCounter(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    return null;
  }
  return value;
}

function diskLabel(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim().replace(/ Media$/, "");
  // Leave room for a disambiguating suffix when two disks share a name.
  return clip(trimmed, 76);
}

function isComplete(disk: PendingDisk): disk is PendingDisk & {
  name: string;
  readBytes: number;
  writeBytes: number;
  readOps: number;
  writeOps: number;
} {
  return (
    disk.name !== null &&
    disk.readBytes !== null &&
    disk.writeBytes !== null &&
    disk.readOps !== null &&
    disk.writeOps !== null
  );
}

function uniqueDisks(
  disks: ReadonlyArray<
    PendingDisk & {
      name: string;
      readBytes: number;
      writeBytes: number;
      readOps: number;
      writeOps: number;
    }
  >,
): DiskIoRaw[] {
  const seenIds = new Set<string>();
  const nameCount = new Map<string, number>();
  const result: DiskIoRaw[] = [];
  for (const disk of disks) {
    if (seenIds.has(disk.id)) {
      continue;
    }
    seenIds.add(disk.id);
    const seen = nameCount.get(disk.name) ?? 0;
    nameCount.set(disk.name, seen + 1);
    result.push({
      id: disk.id,
      name: seen === 0 ? disk.name : `${disk.name} ${seen + 1}`,
      readBytes: disk.readBytes,
      writeBytes: disk.writeBytes,
      readOps: disk.readOps,
      writeOps: disk.writeOps,
    });
  }
  return result;
}

function clip(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
