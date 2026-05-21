import os from "node:os";
import type { CollectorWarning, MemoryInfo } from "../types.js";
import { parseNumber } from "../utils/parse.js";
import { runCollectorCommand } from "../utils/shell.js";

export async function collectMemory(warnings: CollectorWarning[]): Promise<MemoryInfo> {
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
