import os from "node:os";
import type { CollectorWarning, SystemInfo } from "../types.js";
import { runPowerShellJson } from "../utils/powershell.js";
import { safeExec } from "../utils/safeExec.js";
import { runCollectorCommand } from "../utils/shell.js";

export async function collectSystem(anonymize: boolean, warnings: CollectorWarning[]): Promise<SystemInfo> {
  if (process.platform === "win32") return collectWindowsSystem(anonymize);

  const osRelease = process.platform === "linux"
    ? await runCollectorCommand("system", warnings, "sh", ["-c", ". /etc/os-release 2>/dev/null && printf '%s' \"$PRETTY_NAME\""], 2000)
    : await platformName();
  const kernel = await runCollectorCommand("system", warnings, "uname", ["-r"], 2000);
  const arch = await runCollectorCommand("system", warnings, "uname", ["-m"], 2000);

  return {
    osName: osRelease || os.type(),
    kernel,
    architecture: arch || os.arch(),
    hostname: anonymize ? "[anonymized]" : os.hostname(),
    anonymized: anonymize
  };
}

async function collectWindowsSystem(anonymize: boolean): Promise<SystemInfo> {
  const info = await runPowerShellJson<{
    Caption?: string;
    Version?: string;
    BuildNumber?: string;
    OSArchitecture?: string;
  }>("Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture", 5000);
  return {
    osName: info?.Caption ? `${info.Caption} ${info.Version ?? ""}`.trim() : "Windows",
    kernel: info?.BuildNumber ?? os.release(),
    architecture: info?.OSArchitecture ?? os.arch(),
    hostname: anonymize ? "[anonymized]" : os.hostname(),
    anonymized: anonymize
  };
}

async function platformName(): Promise<string | null> {
  if (process.platform === "darwin") {
    const product = await safeExec("sw_vers", ["-productName"], 2000);
    const version = await safeExec("sw_vers", ["-productVersion"], 2000);
    if (product.ok || version.ok) return `${product.stdout || "macOS"} ${version.stdout}`.trim();
    return "macOS";
  }
  if (process.platform === "win32") return "Windows";
  return os.type();
}
