import os from "node:os";
import type { CollectorWarning, NetworkInfo } from "../types.js";
import { parseNumber, redactLocalIps } from "../utils/parse.js";
import { safeExec } from "../utils/safeExec.js";
import { runCollectorCommand } from "../utils/shell.js";

export async function collectNetwork(anonymize: boolean, warnings: CollectorWarning[]): Promise<NetworkInfo> {
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
