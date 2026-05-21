import { safeExec } from "../utils/safeExec.js";

export async function runNetworkBenchmark(hosts: string[]): Promise<Array<{ host: string; latencyMs: number | null }>> {
  const results = [];
  for (const host of hosts) {
    const ping = await safeExec("ping", ["-c", "3", "-W", "2", host], 7000);
    const avg = ping.stdout.match(/= [\d.]+\/([\d.]+)\//)?.[1] ?? null;
    results.push({ host, latencyMs: avg ? Number(avg) : null });
  }
  return results;
}
