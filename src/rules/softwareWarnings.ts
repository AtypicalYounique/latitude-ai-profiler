import type { Bottleneck, ScanReport } from "../types.js";

export function inferSoftwareWarnings(profile: Pick<ScanReport, "gpu" | "aiSoftware">): Bottleneck[] {
  const warnings: Bottleneck[] = [];
  const driverMajor = profile.gpu.driverVersion ? Number(profile.gpu.driverVersion.split(".")[0]) : null;
  if (driverMajor !== null && driverMajor < 535) {
    warnings.push({
      id: "old-nvidia-driver",
      severity: "warning",
      title: "Possibly old NVIDIA driver",
      detail: "The NVIDIA driver may be older than common CUDA 12-era serving stacks expect. Validate framework and container compatibility."
    });
  }
  return warnings;
}
