import type { Bottleneck, ScanReport } from "../types.js";

export function inferBottlenecks(profile: Omit<ScanReport, "bottlenecks" | "recommendation">): Bottleneck[] {
  const bottlenecks: Bottleneck[] = [];
  const gpus = profile.gpu.gpus;
  const maxVram = Math.max(0, ...gpus.map((gpu) => gpu.vramTotalMiB ?? 0));
  const hasAccelerator = gpus.length > 0 || Boolean(profile.gpu.acceleratorPresent);
  const hasNvidia = profile.gpu.nvidiaPresent;
  const avgGpuUtil = average(gpus.map((gpu) => gpu.utilizationGpuPercent));
  const avgVramUsed = average(gpus.map((gpu) => gpu.vramUsedMiB && gpu.vramTotalMiB ? (gpu.vramUsedMiB / gpu.vramTotalMiB) * 100 : null));
  const ramGiB = profile.memory.totalBytes ? profile.memory.totalBytes / 1024 ** 3 : null;
  const root = profile.storage.find((mount) => mount.mountpoint === "/");

  if (!hasAccelerator) {
    bottlenecks.push({
      id: "no-gpu",
      severity: "critical",
      title: "No GPU or accelerator detected",
      detail: "This node is likely not suitable for GPU inference or fine-tuning, though it may fit CPU orchestration, vector DB, RPC, or backend workloads."
    });
  } else if (!hasNvidia) {
    bottlenecks.push({
      id: "non-nvidia-accelerator",
      severity: "info",
      title: "Non-NVIDIA accelerator detected",
      detail: "This can be useful for local AI development, but CUDA-specific data-center serving stacks should be validated again on the target NVIDIA/Linux environment."
    });
  } else if (maxVram < 24 * 1024) {
    bottlenecks.push({
      id: "low-vram",
      severity: "warning",
      title: "Low GPU memory",
      detail: "Available VRAM is likely best suited for small or quantized models, embeddings, and dev/test. Larger production inference should validate memory headroom."
    });
  }

  if (avgVramUsed !== null && avgVramUsed > 85) {
    bottlenecks.push({
      id: "vram-pressure",
      severity: "warning",
      title: "Possible VRAM pressure",
      detail: "GPU memory usage is high. This may indicate model weight, batch size, or KV cache pressure and should be validated under representative traffic."
    });
  }

  if (avgGpuUtil !== null && avgGpuUtil < 25 && avgVramUsed !== null && avgVramUsed > 70) {
    bottlenecks.push({
      id: "memory-bound-gpu",
      severity: "warning",
      title: "GPU may be memory-capacity limited",
      detail: "GPU utilization is low while VRAM usage is high, which can happen when serving is constrained by memory capacity or KV cache rather than compute."
    });
  }

  if (ramGiB !== null && ramGiB < 32) {
    bottlenecks.push({
      id: "low-ram",
      severity: "warning",
      title: "Limited system RAM",
      detail: "System RAM is likely tight for larger model serving stacks, preprocessing, vector databases, or high-concurrency orchestration."
    });
  }

  if ((profile.cpu.logicalThreads ?? 0) < 8) {
    bottlenecks.push({
      id: "weak-cpu",
      severity: "warning",
      title: "CPU may limit orchestration",
      detail: "The CPU thread count is modest. It may become a bottleneck for tokenization, request routing, data loading, or container orchestration."
    });
  }

  if (root?.usePercent !== null && root?.usePercent !== undefined && root.usePercent > 85) {
    bottlenecks.push({
      id: "disk-capacity",
      severity: "warning",
      title: "Disk capacity risk",
      detail: "Root filesystem usage is high. Model caches, container images, logs, or datasets could exhaust capacity if not managed."
    });
  }

  if (hasNvidia && !profile.gpu.cudaVersion) {
    bottlenecks.push({
      id: "cuda-missing",
      severity: "warning",
      title: "CUDA version not reported",
      detail: "nvidia-smi did not report a CUDA compatibility version. Runtime compatibility should be validated before production serving."
    });
  }

  if (profile.aiSoftware.packages.torch && !hasAccelerator) {
    bottlenecks.push({
      id: "torch-no-gpu",
      severity: "warning",
      title: "PyTorch detected without NVIDIA GPU",
      detail: "PyTorch is installed, but no NVIDIA GPU was detected. GPU acceleration may be unavailable on this node."
    });
  }

  if (!profile.aiSoftware.packages.vllm) {
    bottlenecks.push({
      id: "vllm-missing",
      severity: "info",
      title: "vLLM not detected",
      detail: "For LLM inference, vLLM may be a software optimization opportunity depending on the workload and model architecture."
    });
  }

  if (!profile.aiSoftware.packages.tensorrt_llm) {
    bottlenecks.push({
      id: "tensorrt-llm-missing",
      severity: "info",
      title: "TensorRT-LLM not detected",
      detail: "TensorRT-LLM may be worth evaluating for optimized NVIDIA inference, though fit depends on models, latency goals, and deployment workflow."
    });
  }

  if (!profile.docker.installed) {
    bottlenecks.push({
      id: "container-runtime-missing",
      severity: "info",
      title: "Docker not detected",
      detail: "A container runtime was not detected. Production AI serving commonly benefits from a reproducible containerized stack."
    });
  }

  return bottlenecks;
}

function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}
