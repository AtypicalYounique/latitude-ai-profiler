import type { ScanReport } from "../types.js";
import { formatWorkloadIntent } from "../rules/workloadIntent.js";
import { bytesToGiB } from "../utils/parse.js";

export function renderSummary(report: ScanReport): string {
  const mainBottleneck = report.bottlenecks[0]?.title ?? "No major bottleneck inferred";
  const requestedFit = report.modelFit.intentFit
    ? `${report.modelFit.intentFit.fitType.replace(/_/g, " ")} (${report.modelFit.intentFit.confidence})`
    : "not specified";

  return [
    "Latitude AI Node Profiler",
    "",
    `Machine: ${currentMachineClass(report)}`,
    `CPU: ${report.cpu.model ?? "unknown"} (${report.cpu.logicalThreads ?? "unknown"} threads)`,
    `Memory: ${bytesToGiB(report.memory.totalBytes)}`,
    `Accelerator: ${acceleratorSummary(report)}`,
    `Workload Intent: ${formatWorkloadIntent(report.workloadIntent)}`,
    `Requested Fit: ${requestedFit}`,
    `Main Bottleneck: ${mainBottleneck}`,
    "",
    `Recommended Latitude Class: ${report.recommendation.recommendedTargetClass}`,
    `Cheaper Alternative: ${report.recommendation.cheaperAlternative}`,
    `Performance Alternative: ${report.recommendation.performanceAlternative}`,
    `Confidence: ${report.recommendation.confidence}`,
    "",
    "Privacy: collected infrastructure metadata only; no code, prompts, datasets, model weights, env vars, secrets, keys, or customer files.",
    "Use --md report.md or --json report.json for the full report. Use --full to print the full Markdown report.",
    ""
  ].join("\n");
}

export function currentMachineClass(report: ScanReport): string {
  if (!report.gpu.gpus.length) return "CPU-only node";
  if (!report.gpu.nvidiaPresent) return "local/shared-memory accelerator node";
  const maxVram = Math.max(0, ...report.gpu.gpus.map((gpu) => gpu.vramTotalMiB ?? 0));
  if (report.gpu.gpuCount > 1 && maxVram >= 80 * 1024) return "multi-GPU high-memory node";
  if (maxVram >= 120 * 1024) return "H200-class high-memory GPU node";
  if (maxVram >= 70 * 1024) return "H100-class GPU node";
  if (maxVram >= 24 * 1024) return "medium GPU inference node";
  return "small GPU node";
}

function acceleratorSummary(report: ScanReport): string {
  if (!report.gpu.gpus.length) return "none detected";
  return report.gpu.gpus
    .map((gpu) => {
      const memory = gpu.vramTotalMiB ? `${(gpu.vramTotalMiB / 1024).toFixed(0)} GiB` : "unknown memory";
      const kind = gpu.sharedMemory ? "unified/shared memory" : "VRAM";
      return `${gpu.name ?? "Unknown accelerator"} (${memory} ${kind})`;
    })
    .join(", ");
}
