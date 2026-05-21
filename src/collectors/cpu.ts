import os from "node:os";
import type { CollectorWarning, CpuInfo } from "../types.js";
import { parseKeyValueLines, parseNumber } from "../utils/parse.js";
import { safeExec } from "../utils/safeExec.js";
import { runCollectorCommand } from "../utils/shell.js";

export async function collectCpu(warnings: CollectorWarning[]): Promise<CpuInfo> {
  if (process.platform === "darwin") return collectDarwinCpu();

  const lscpu = await runCollectorCommand("cpu", warnings, "lscpu", [], 3000);
  if (!lscpu) {
    const cpus = os.cpus();
    return {
      model: cpus[0]?.model ?? null,
      physicalCores: null,
      logicalThreads: cpus.length || null,
      sockets: null,
      currentMhz: cpus[0]?.speed ?? null,
      maxMhz: null
    };
  }

  const kv = parseKeyValueLines(lscpu);
  const sockets = parseNumber(kv.Socket);
  const coresPerSocket = parseNumber(kv["Core(s) per socket"]);
  return {
    model: kv["Model name"] ?? kv["BIOS Model name"] ?? null,
    physicalCores: sockets && coresPerSocket ? sockets * coresPerSocket : null,
    logicalThreads: parseNumber(kv.CPU),
    sockets,
    currentMhz: parseNumber(kv["CPU MHz"]),
    maxMhz: parseNumber(kv["CPU max MHz"])
  };
}

async function collectDarwinCpu(): Promise<CpuInfo> {
  const [brand, physical, logical, freq] = await Promise.all([
    safeExec("sysctl", ["-n", "machdep.cpu.brand_string"], 2000),
    safeExec("sysctl", ["-n", "hw.physicalcpu"], 2000),
    safeExec("sysctl", ["-n", "hw.logicalcpu"], 2000),
    safeExec("sysctl", ["-n", "hw.cpufrequency_max"], 2000)
  ]);
  const cpus = os.cpus();
  const maxHz = parseNumber(freq.stdout);
  return {
    model: brand.ok && brand.stdout ? brand.stdout : cpus[0]?.model ?? null,
    physicalCores: parseNumber(physical.stdout),
    logicalThreads: parseNumber(logical.stdout) ?? cpus.length,
    sockets: 1,
    currentMhz: cpus[0]?.speed ?? null,
    maxMhz: maxHz ? maxHz / 1_000_000 : null
  };
}
