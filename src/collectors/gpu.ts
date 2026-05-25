import os from "node:os";
import type { CollectorWarning, GpuDevice, GpuInfo } from "../types.js";
import { parseNumber } from "../utils/parse.js";
import { runPowerShellJson } from "../utils/powershell.js";
import { commandExists, safeExec } from "../utils/safeExec.js";

const QUERY_FIELDS = [
  "index",
  "name",
  "pci.bus_id",
  "memory.total",
  "memory.used",
  "memory.free",
  "utilization.gpu",
  "utilization.memory",
  "power.draw",
  "driver_version",
  "cuda_version"
];

export async function collectGpu(warnings: CollectorWarning[]): Promise<GpuInfo> {
  if (process.platform === "darwin") {
    const apple = await collectAppleAccelerator();
    if (apple) {
      return { acceleratorPresent: true, nvidiaPresent: false, driverVersion: null, cudaVersion: null, gpuCount: 1, gpus: [apple] };
    }
  }

  if (!(await commandExists("nvidia-smi"))) {
    if (process.platform === "win32") return collectWindowsDisplayAdapters();
    return { acceleratorPresent: false, nvidiaPresent: false, driverVersion: null, cudaVersion: null, gpuCount: 0, gpus: [] };
  }

  const result = await safeExec("nvidia-smi", [`--query-gpu=${QUERY_FIELDS.join(",")}`, "--format=csv,noheader,nounits"], 5000);
  if (!result.ok) {
    warnings.push({ collector: "gpu", message: `nvidia-smi failed: ${result.stderr || "unknown error"}` });
    return { acceleratorPresent: false, nvidiaPresent: false, driverVersion: null, cudaVersion: null, gpuCount: 0, gpus: [] };
  }

  const gpus: GpuDevice[] = [];
  let driverVersion: string | null = null;
  let cudaVersion: string | null = null;
  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const cols = line.split(",").map((part) => part.trim());
    driverVersion ??= emptyToNull(cols[9]);
    cudaVersion ??= emptyToNull(cols[10]);
    gpus.push({
      index: parseNumber(cols[0]) ?? gpus.length,
      name: emptyToNull(cols[1]),
      vendor: "nvidia",
      sharedMemory: false,
      pciBusId: emptyToNull(cols[2]),
      vramTotalMiB: parseNumber(cols[3]),
      vramUsedMiB: parseNumber(cols[4]),
      vramFreeMiB: parseNumber(cols[5]),
      utilizationGpuPercent: parseNumber(cols[6]),
      utilizationMemoryPercent: parseNumber(cols[7]),
      powerDrawWatts: parseNumber(cols[8])
    });
  }

  return { acceleratorPresent: gpus.length > 0, nvidiaPresent: gpus.length > 0, driverVersion, cudaVersion, gpuCount: gpus.length, gpus };
}

async function collectWindowsDisplayAdapters(): Promise<GpuInfo> {
  const adapters = await runPowerShellJson<Array<{
    Name?: string;
    AdapterRAM?: number;
    PNPDeviceID?: string;
    DriverVersion?: string;
  }> | {
    Name?: string;
    AdapterRAM?: number;
    PNPDeviceID?: string;
    DriverVersion?: string;
  }>("Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,PNPDeviceID,DriverVersion", 5000);
  const rows = Array.isArray(adapters) ? adapters : adapters ? [adapters] : [];
  const gpus: GpuDevice[] = rows
    .filter((adapter) => adapter.Name)
    .map((adapter, index) => ({
      index,
      name: adapter.Name ?? null,
      vendor: inferVendor(adapter.Name ?? ""),
      sharedMemory: false,
      pciBusId: adapter.PNPDeviceID ?? null,
      vramTotalMiB: adapter.AdapterRAM ? adapter.AdapterRAM / 1024 / 1024 : null,
      vramUsedMiB: null,
      vramFreeMiB: null,
      utilizationGpuPercent: null,
      utilizationMemoryPercent: null,
      powerDrawWatts: null
    }));
  const nvidia = gpus.find((gpu) => gpu.vendor === "nvidia");
  return {
    acceleratorPresent: gpus.length > 0,
    nvidiaPresent: Boolean(nvidia),
    driverVersion: nvidia ? rows[gpus.indexOf(nvidia)]?.DriverVersion ?? null : null,
    cudaVersion: null,
    gpuCount: gpus.length,
    gpus
  };
}

function inferVendor(name: string): GpuDevice["vendor"] {
  if (/nvidia/i.test(name)) return "nvidia";
  if (/amd|radeon/i.test(name)) return "amd";
  if (/intel/i.test(name)) return "intel";
  return "unknown";
}

function emptyToNull(value: string | undefined): string | null {
  if (!value || value === "[Not Supported]" || value === "N/A") return null;
  return value;
}

async function collectAppleAccelerator(): Promise<GpuDevice | null> {
  const [brand, mem] = await Promise.all([
    safeExec("sysctl", ["-n", "machdep.cpu.brand_string"], 2000),
    safeExec("sysctl", ["-n", "hw.memsize"], 2000)
  ]);
  const cpuModel = brand.stdout || os.cpus()[0]?.model || "";
  const isAppleSilicon = /Apple\s+M\d/i.test(cpuModel);
  if (!isAppleSilicon) return null;
  const totalBytes = parseNumber(mem.stdout) ?? os.totalmem();
  return {
    index: 0,
    name: `${cpuModel || "Apple Silicon"} integrated GPU`,
    vendor: "apple",
    sharedMemory: true,
    pciBusId: null,
    vramTotalMiB: totalBytes ? totalBytes / 1024 / 1024 : null,
    vramUsedMiB: null,
    vramFreeMiB: null,
    utilizationGpuPercent: null,
    utilizationMemoryPercent: null,
    powerDrawWatts: null
  };
}
