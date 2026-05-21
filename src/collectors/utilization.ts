import os from "node:os";
import type { CollectorWarning, DockerInfo, UtilizationInfo } from "../types.js";
import { safeExec } from "../utils/safeExec.js";

const MODEL_SERVER_HINTS = ["vllm", "text-generation-inference", "tgi", "sglang", "ollama", "llama"];

export async function collectUtilization(docker: DockerInfo, warnings: CollectorWarning[]): Promise<UtilizationInfo> {
  const runningModelServers = new Set<string>();
  for (const container of docker.containers) {
    const haystack = `${container.image} ${container.name ?? ""}`.toLowerCase();
    if (MODEL_SERVER_HINTS.some((hint) => haystack.includes(hint))) runningModelServers.add(container.image);
  }

  const ps = await safeExec("ps", ["-eo", "comm="], 3000);
  if (ps.ok) {
    for (const proc of ps.stdout.split(/\r?\n/)) {
      const lower = proc.toLowerCase();
      if (MODEL_SERVER_HINTS.some((hint) => lower.includes(hint))) runningModelServers.add(proc);
    }
  } else {
    warnings.push({ collector: "utilization", message: "process list unavailable; model server detection is partial" });
  }

  return {
    loadAverage: os.loadavg(),
    runningModelServers: [...runningModelServers].sort()
  };
}
