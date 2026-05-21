import type { CollectorWarning, StorageMount } from "../types.js";
import { parseNumber } from "../utils/parse.js";
import { runCollectorCommand } from "../utils/shell.js";

export async function collectStorage(warnings: CollectorWarning[]): Promise<StorageMount[]> {
  if (process.platform === "darwin") return collectDarwinStorage(warnings);

  const df = await runCollectorCommand("storage", warnings, "df", ["-B1", "-P", "-T"], 5000);
  const lsblk = await runCollectorCommand("storage", warnings, "lsblk", ["-J", "-o", "NAME,TYPE,ROTA,MOUNTPOINT"], 5000);
  const deviceTypes = parseDeviceTypes(lsblk);
  if (!df) return [];

  return df
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 7)
    .map((cols) => {
      const filesystem = cols[0] ?? null;
      const mountpoint = cols.slice(6).join(" ") || null;
      return {
        filesystem,
        type: cols[1] ?? null,
        sizeBytes: parseNumber(cols[2]),
        usedBytes: parseNumber(cols[3]),
        availableBytes: parseNumber(cols[4]),
        usePercent: parseNumber(cols[5]),
        mountpoint,
        deviceType: deviceTypes.get(mountpoint ?? "") ?? null
      };
    });
}

function parseDeviceTypes(lsblkJson: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!lsblkJson) return map;
  try {
    const parsed = JSON.parse(lsblkJson) as { blockdevices?: Array<Record<string, unknown>> };
    const visit = (device: Record<string, unknown>) => {
      const mountpoint = typeof device.mountpoint === "string" ? device.mountpoint : null;
      if (mountpoint) {
        const rota = device.rota;
        const type = rota === false || rota === 0 ? "ssd/nvme-like" : rota === true || rota === 1 ? "rotational" : String(device.type ?? "unknown");
        map.set(mountpoint, type);
      }
      const children = Array.isArray(device.children) ? device.children : [];
      for (const child of children) visit(child as Record<string, unknown>);
    };
    for (const device of parsed.blockdevices ?? []) visit(device);
  } catch {
    return map;
  }
  return map;
}

async function collectDarwinStorage(warnings: CollectorWarning[]): Promise<StorageMount[]> {
  const df = await runCollectorCommand("storage", warnings, "df", ["-k", "-P"], 5000);
  if (!df) return [];
  return df
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 6)
    .map((cols) => {
      const sizeBytes = kibToBytes(parseNumber(cols[1]));
      const usedBytes = kibToBytes(parseNumber(cols[2]));
      const availableBytes = kibToBytes(parseNumber(cols[3]));
      return {
        filesystem: cols[0] ?? null,
        type: null,
        sizeBytes,
        usedBytes,
        availableBytes,
        usePercent: parseNumber(cols[4]),
        mountpoint: cols.slice(5).join(" ") || null,
        deviceType: cols[0]?.startsWith("/dev/") ? "local" : null
      };
    });
}

function kibToBytes(value: number | null): number | null {
  return value === null ? null : value * 1024;
}
