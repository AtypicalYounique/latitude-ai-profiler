import os from "node:os";
import type { CollectorWarning, MemoryInfo } from "../types.js";
import { parseNumber } from "../utils/parse.js";
import { runPowerShellJson } from "../utils/powershell.js";
import { runCollectorCommand } from "../utils/shell.js";

export async function collectMemory(warnings: CollectorWarning[]): Promise<MemoryInfo> {
  if (process.platform === "win32") return collectWindowsMemory();

  if (process.platform !== "linux") {
    return {
      totalBytes: os.totalmem(),
      availableBytes: os.freemem(),
      swapTotalBytes: null,
      swapUsedBytes: null
    };
  }

  const free = await runCollectorCommand("memory", warnings, "free", ["-b"], 3000);
  if (!free) {
    return {
      totalBytes: os.totalmem(),
      availableBytes: os.freemem(),
      swapTotalBytes: null,
      swapUsedBytes: null
    };
  }

  const lines = free.split(/\r?\n/);
  const mem = lines.find((line) => line.startsWith("Mem:"))?.split(/\s+/) ?? [];
  const swap = lines.find((line) => line.startsWith("Swap:"))?.split(/\s+/) ?? [];
  return {
    totalBytes: parseNumber(mem[1]),
    availableBytes: parseNumber(mem[6] ?? mem[3]),
    swapTotalBytes: parseNumber(swap[1]),
    swapUsedBytes: parseNumber(swap[2])
  };
}

async function collectWindowsMemory(): Promise<MemoryInfo> {
  const info = await runPowerShellJson<{
    TotalVisibleMemorySize?: number;
    FreePhysicalMemory?: number;
    TotalVirtualMemorySize?: number;
    FreeVirtualMemory?: number;
  }>("Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory,TotalVirtualMemorySize,FreeVirtualMemory", 5000);
  const totalVirtual = kibToBytes(info?.TotalVirtualMemorySize ?? null);
  const freeVirtual = kibToBytes(info?.FreeVirtualMemory ?? null);
  return {
    totalBytes: kibToBytes(info?.TotalVisibleMemorySize ?? null) ?? os.totalmem(),
    availableBytes: kibToBytes(info?.FreePhysicalMemory ?? null) ?? os.freemem(),
    swapTotalBytes: totalVirtual && info?.TotalVisibleMemorySize ? totalVirtual - info.TotalVisibleMemorySize * 1024 : null,
    swapUsedBytes: totalVirtual && freeVirtual && info?.TotalVisibleMemorySize && info?.FreePhysicalMemory
      ? (totalVirtual - info.TotalVisibleMemorySize * 1024) - (freeVirtual - info.FreePhysicalMemory * 1024)
      : null
  };
}

function kibToBytes(value: number | null): number | null {
  return value === null ? null : value * 1024;
}
