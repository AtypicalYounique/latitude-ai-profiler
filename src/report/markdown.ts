import type { ScanReport } from "../types.js";
import { formatWorkloadIntent } from "../rules/workloadIntent.js";
import { currentMachineClass } from "./summary.js";
import { bytesToGiB } from "../utils/parse.js";

export function renderMarkdown(report: ScanReport): string {
  const mainBottleneck = report.bottlenecks[0]?.title ?? "No major bottleneck inferred from metadata alone";
  const gpuSummary = report.gpu.gpus.length
    ? report.gpu.gpus.map((gpu) => `${gpu.name ?? "Unknown GPU"} (${gpu.vramTotalMiB ? (gpu.vramTotalMiB / 1024).toFixed(0) : "unknown"} GiB ${gpu.sharedMemory ? "unified/shared memory" : "VRAM"})`).join(", ")
    : "No GPU or accelerator detected";

  return `# Latitude AI Node Profiler Report

Generated: ${report.generatedAt}

## Executive Summary

- Current machine class: ${currentMachineClass(report)}
- Main bottleneck: ${mainBottleneck}
- Recommended Latitude class: ${report.recommendation.recommendedTargetClass}
- Confidence: ${report.recommendation.confidence}
- Workload intent: ${formatWorkloadIntent(report.workloadIntent)}

## Detected Hardware

- CPU: ${report.cpu.model ?? "unknown"} (${report.cpu.physicalCores ?? "unknown"} physical cores, ${report.cpu.logicalThreads ?? "unknown"} threads)
- RAM: ${bytesToGiB(report.memory.totalBytes)} total, ${bytesToGiB(report.memory.availableBytes)} available
- GPU: ${gpuSummary}
- Storage: ${report.storage.slice(0, 8).map((mount) => `${mount.mountpoint ?? "unknown"} ${bytesToGiB(mount.sizeBytes)} total, ${bytesToGiB(mount.availableBytes)} free`).join("; ") || "unknown"}
- Network: ${report.network.interfaces.map((net) => `${net.name}${net.speedMbps ? ` ${net.speedMbps} Mbps` : ""}`).join(", ") || "unknown"}

## Detected Software

- OS: ${report.system.osName ?? "unknown"}
- Kernel: ${report.system.kernel ?? "unknown"}
- NVIDIA driver: ${report.gpu.nvidiaPresent ? report.gpu.driverVersion ?? "not detected" : "not applicable"}
- CUDA compatibility: ${report.gpu.nvidiaPresent ? report.gpu.cudaVersion ?? "not detected" : "not applicable"}
- Docker: ${report.docker.installed ? report.docker.daemonRunning ? "installed and running" : "installed, daemon unavailable" : "not detected"}
- Kubernetes: ${report.kubernetes.kubectlInstalled ? `kubectl detected${report.kubernetes.currentContext ? `, context ${report.kubernetes.currentContext}` : ""}` : "not detected"}
- Python: ${report.python.version ?? "not detected"}
- AI runtimes: ${detectedAiPackages(report)}

## AI Workload Fit

${report.recommendation.currentFit.map((item) => `- ${item}`).join("\n")}

${formatWorkloadIntentSection(report)}

## Model Size Fit Estimate

${formatModelFit(report)}

## Likely Bottlenecks

${report.bottlenecks.length ? report.bottlenecks.map((item) => `- ${item.title}: ${item.detail}`).join("\n") : "- Not enough information to identify a likely bottleneck from metadata alone."}

## Recommended Latitude Target

${report.recommendation.recommendedTargetClass}

${report.recommendation.likelyLimitations.map((item) => `- ${item}`).join("\n")}

## Cheaper Alternative

${report.recommendation.cheaperAlternative}

## Performance Alternative

${report.recommendation.performanceAlternative}

## What to Validate on a Sales Call

${report.recommendation.validationQuestions.map((item) => `- ${item}`).join("\n")}

## Software Stack Notes

- Running containers observed: ${report.docker.containers.length}
- Running model servers detected: ${report.utilization.runningModelServers.join(", ") || "none detected"}
- Collector warnings: ${formatWarnings(report)}

## Privacy Note

Anonymization: ${report.privacy.anonymize ? "enabled" : "disabled"}.

Collected: ${report.privacy.collected.join(", ")}.

Not collected: ${report.privacy.notCollected.join(", ")}.
`;
}

function detectedAiPackages(report: ScanReport): string {
  const found = Object.entries(report.aiSoftware.packages)
    .filter(([, version]) => Boolean(version))
    .map(([name, version]) => `${name}${version ? ` ${version}` : ""}`);
  return found.join(", ") || "none detected through Python package metadata";
}

function formatModelFit(report: ScanReport): string {
  const lines = [
    `- Best accelerator memory: ${report.modelFit.bestGpuVramGiB === null ? "not detected" : `${report.modelFit.bestGpuVramGiB.toFixed(1)} GiB`}`,
    `- Usable RAM planning assumption: ${report.modelFit.usableSystemRamGiB === null ? "unknown" : `${report.modelFit.usableSystemRamGiB.toFixed(1)} GiB`}`,
    ...(report.modelFit.intentFit ? [`- ${report.modelFit.intentFit.workload}: ${report.modelFit.intentFit.fitType.replace(/_/g, " ")} (${report.modelFit.intentFit.confidence}) - ${report.modelFit.intentFit.rationale}`] : []),
    ...report.modelFit.workloads.map((fit) => `- ${fit.workload}: ${fit.fitType.replace(/_/g, " ")} (${fit.confidence}) - ${fit.rationale}`)
  ];
  return lines.join("\n");
}

function formatWorkloadIntentSection(report: ScanReport): string {
  if (!report.workloadIntent) return "";
  const warnings = report.workloadIntent.warnings.length
    ? `\n- Intent parsing notes: ${report.workloadIntent.warnings.join("; ")}`
    : "";
  return `## Requested Workload

- Intent: ${formatWorkloadIntent(report.workloadIntent)}
- This is user-provided planning metadata only; no prompts, datasets, model weights, code, or files were inspected.${warnings}
`;
}

function formatWarnings(report: ScanReport): string {
  if (!report.warnings.length) return "none";
  const shown = report.warnings.slice(0, 8).map((warning) => `${warning.collector}: ${warning.message}`);
  const hidden = report.warnings.length - shown.length;
  return `${shown.join("; ")}${hidden > 0 ? `; plus ${hidden} more warning(s) in the JSON report` : ""}`;
}
