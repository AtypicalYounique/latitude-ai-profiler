import os from "node:os";
import type { CollectorWarning, NetworkInfo } from "../types.js";
import { parseNumber, redactLocalIps } from "../utils/parse.js";
import { runPowerShellJson, runPowerShellText } from "../utils/powershell.js";
import { safeExec } from "../utils/safeExec.js";
import { runCollectorCommand } from "../utils/shell.js";

export async function collectNetwork(anonymize: boolean, warnings: CollectorWarning[]): Promise<NetworkInfo> {
  if (process.platform === "win32") return collectWindowsNetwork(anonymize);

  const defaultRouteInterface = await defaultInterface(warnings);
  const nets = os.networkInterfaces();

  const interfaces = await Promise.all(
    Object.entries(nets).map(async ([name, addresses]) => {
      const state = process.platform === "linux"
        ? await runCollectorCommand("network", warnings, "sh", ["-c", `cat /sys/class/net/${safeName(name)}/operstate 2>/dev/null`], 1000)
        : null;
      const speed = process.platform === "linux"
        ? await runCollectorCommand("network", warnings, "sh", ["-c", `cat /sys/class/net/${safeName(name)}/speed 2>/dev/null`], 1000)
        : null;
      return {
        name,
        state,
        speedMbps: parseNumber(speed),
        addresses: anonymize ? [] : (addresses ?? []).map((addr) => redactLocalIps(addr.address))
      };
    })
  );

  return { interfaces, defaultRouteInterface };
}

async function collectWindowsNetwork(anonymize: boolean): Promise<NetworkInfo> {
  const defaultRouteInterface = await runPowerShellText("(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty InterfaceAlias)", 3000);
  const adapters = await runPowerShellJson<Array<{
    Name?: string;
    Status?: string;
    LinkSpeed?: string;
  }> | {
    Name?: string;
    Status?: string;
    LinkSpeed?: string;
  }>("Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name,Status,LinkSpeed", 5000);
  const adapterRows = Array.isArray(adapters) ? adapters : adapters ? [adapters] : [];
  const adapterMap = new Map(adapterRows.map((adapter) => [adapter.Name, adapter]));
  const nets = os.networkInterfaces();
  return {
    defaultRouteInterface: defaultRouteInterface?.trim() || null,
    interfaces: Object.entries(nets).map(([name, addresses]) => {
      const adapter = adapterMap.get(name);
      return {
        name,
        state: adapter?.Status ?? null,
        speedMbps: parseWindowsLinkSpeed(adapter?.LinkSpeed),
        addresses: anonymize ? [] : (addresses ?? []).map((addr) => redactLocalIps(addr.address))
      };
    })
  };
}

function parseWindowsLinkSpeed(value: string | undefined): number | null {
  if (!value) return null;
  const match = /([\d.]+)\s*(Gbps|Mbps|Kbps)/i.exec(value);
  if (!match) return null;
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return null;
  const unit = match[2].toLowerCase();
  if (unit === "gbps") return number * 1000;
  if (unit === "mbps") return number;
  if (unit === "kbps") return number / 1000;
  return null;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.:-]/g, "");
}

async function defaultInterface(warnings: CollectorWarning[]): Promise<string | null> {
  if (process.platform === "linux") {
    const route = await runCollectorCommand("network", warnings, "sh", ["-c", "ip route show default 2>/dev/null | head -1"], 3000);
    return route?.match(/\bdev\s+(\S+)/)?.[1] ?? null;
  }
  if (process.platform === "darwin") {
    const route = await safeExec("route", ["-n", "get", "default"], 3000);
    return route.stdout.match(/interface:\s*(\S+)/)?.[1] ?? null;
  }
  return null;
}
