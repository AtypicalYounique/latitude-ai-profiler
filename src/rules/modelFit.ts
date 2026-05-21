import type { ModelFitSummary, ScanReport, WorkloadFitEstimate, WorkloadFitType, WorkloadIntent } from "../types.js";

const GIB = 1024 ** 3;

type ProfileInput = Pick<ScanReport, "cpu" | "memory" | "gpu" | "aiSoftware">;

interface WorkloadBand {
  workload: string;
  minFullGpuGiB: number;
  minPartialGiB: number;
  cpuPossible: boolean;
  note: string;
}

const WORKLOAD_BANDS: WorkloadBand[] = [
  {
    workload: "embeddings and rerankers",
    minFullGpuGiB: 8,
    minPartialGiB: 0,
    cpuPossible: true,
    note: "Small embedding and reranking models usually fit on modest GPUs and may run acceptably on strong CPUs."
  },
  {
    workload: "7B/8B quantized inference",
    minFullGpuGiB: 10,
    minPartialGiB: 6,
    cpuPossible: true,
    note: "A practical floor for Q4/Q5 local inference with normal serving overhead."
  },
  {
    workload: "13B/14B quantized inference",
    minFullGpuGiB: 18,
    minPartialGiB: 12,
    cpuPossible: false,
    note: "Often feasible on 24 GB GPUs, but concurrency and context length can consume headroom quickly."
  },
  {
    workload: "30B/34B quantized inference",
    minFullGpuGiB: 40,
    minPartialGiB: 24,
    cpuPossible: false,
    note: "Usually wants L40S/RTX 6000 Ada/H100-class memory depending on context and concurrency."
  },
  {
    workload: "70B quantized inference",
    minFullGpuGiB: 80,
    minPartialGiB: 48,
    cpuPossible: false,
    note: "Typically needs high-memory accelerators or multi-GPU serving for production-quality latency."
  },
  {
    workload: "large context or high-concurrency serving",
    minFullGpuGiB: 120,
    minPartialGiB: 80,
    cpuPossible: false,
    note: "KV cache can dominate memory use; validate prompt length, batch size, and concurrency."
  },
  {
    workload: "fine-tuning or adapter training",
    minFullGpuGiB: 80,
    minPartialGiB: 48,
    cpuPossible: false,
    note: "Training memory depends heavily on optimizer, precision, LoRA/full fine-tune, and sequence length."
  }
];

export function estimateModelFit(profile: ProfileInput, intent: WorkloadIntent | null = null): ModelFitSummary {
  const gpuVramGiB = profile.gpu.gpus
    .map((gpu) => (gpu.vramTotalMiB ?? 0) / 1024)
    .filter((value) => value > 0);
  const bestGpuVramGiB = gpuVramGiB.length ? Math.max(...gpuVramGiB) : null;
  const totalGpuVramGiB = gpuVramGiB.length ? gpuVramGiB.reduce((sum, value) => sum + value, 0) : null;
  const usableSystemRamGiB = profile.memory.totalBytes ? (profile.memory.totalBytes * 0.8) / GIB : null;
  const hasServingRuntime = Boolean(
    profile.aiSoftware.packages.vllm ||
      profile.aiSoftware.packages.sglang ||
      profile.aiSoftware.packages["text-generation-inference"] ||
      profile.aiSoftware.packages.tensorrt_llm
  );

  const workloads = WORKLOAD_BANDS.map((band) =>
    estimateWorkload(band, bestGpuVramGiB, totalGpuVramGiB, usableSystemRamGiB, hasServingRuntime)
  );
  const intentFit = intent ? estimateIntentWorkload(intent, bestGpuVramGiB, totalGpuVramGiB, usableSystemRamGiB, hasServingRuntime) : undefined;

  return {
    inspiredBy: "Andyyyy64/whichllm fit-type model: separate hardware detection from compatibility estimates, keep assumptions visible, and report fit confidence.",
    assumptions: [
      "Uses broad Q4/Q5 inference memory bands, not exact model-card parsing.",
      "Treats roughly 80% of system RAM as usable for CPU/offload planning.",
      "Does not download models, inspect model weights, or benchmark token throughput.",
      "Production serving should validate concurrency, context length, KV cache, framework overhead, and container/runtime configuration."
    ],
    bestGpuVramGiB,
    totalGpuVramGiB,
    usableSystemRamGiB,
    intentFit,
    workloads
  };
}

export function estimateIntentRequiredGiB(intent: WorkloadIntent): number | null {
  if (intent.workload && ["orchestration", "rpc", "game-server", "preprocessing", "vector-db"].includes(intent.workload)) {
    return null;
  }

  const modelSizeB = intent.modelSizeB ?? defaultModelSizeFor(intent.workload);
  if (!modelSizeB) return null;

  let bytesPerParam = bytesPerParamFor(intent.quantization);
  if (intent.workload === "fine-tuning") bytesPerParam *= 2.2;
  if (intent.workload === "training") bytesPerParam *= 4.0;

  let requiredGiB = modelSizeB * bytesPerParam;
  requiredGiB += Math.max(2, modelSizeB * 0.12);

  const context = intent.contextTokens ?? 4096;
  if (context > 4096) requiredGiB *= 1 + Math.min(1.2, (context / 4096 - 1) * 0.12);

  if (intent.concurrency === "medium") requiredGiB *= 1.25;
  if (intent.concurrency === "high") requiredGiB *= 1.65;

  if (intent.workload === "embeddings") requiredGiB = Math.min(requiredGiB, 16);
  if (intent.workload === "image" || intent.workload === "video") requiredGiB = Math.max(requiredGiB, intent.workload === "video" ? 32 : 24);

  return roundUpBand(requiredGiB);
}

function estimateWorkload(
  band: WorkloadBand,
  bestGpuVramGiB: number | null,
  totalGpuVramGiB: number | null,
  usableSystemRamGiB: number | null,
  hasServingRuntime: boolean
): WorkloadFitEstimate {
  let fitType: WorkloadFitType = "unknown";
  const validationNotes = [band.note];

  if (bestGpuVramGiB !== null && bestGpuVramGiB >= band.minFullGpuGiB) {
    fitType = "full_gpu";
  } else if (totalGpuVramGiB !== null && totalGpuVramGiB >= band.minFullGpuGiB) {
    fitType = "partial_offload";
    validationNotes.push("Multiple GPUs may have enough aggregate VRAM, but tensor parallelism and interconnect need validation.");
  } else if (bestGpuVramGiB !== null && bestGpuVramGiB >= band.minPartialGiB && usableSystemRamGiB !== null && usableSystemRamGiB >= band.minFullGpuGiB) {
    fitType = "partial_offload";
    validationNotes.push("May require CPU/RAM offload; latency can be highly sensitive to PCIe and runtime settings.");
  } else if (bestGpuVramGiB === null && band.cpuPossible && usableSystemRamGiB !== null && usableSystemRamGiB >= band.minFullGpuGiB) {
    fitType = "cpu_only";
    validationNotes.push("CPU-only fit is a functional possibility, not a production latency claim.");
  } else {
    fitType = "not_recommended";
  }

  if (!hasServingRuntime && fitType !== "not_recommended") {
    validationNotes.push("No common production LLM serving runtime was detected; software stack could change the practical result.");
  }

  return {
    workload: band.workload,
    fitType,
    confidence: fitType === "not_recommended" || fitType === "full_gpu" ? "medium" : "low",
    rationale: rationaleFor(fitType, band, bestGpuVramGiB),
    validationNotes
  };
}

function estimateIntentWorkload(
  intent: WorkloadIntent,
  bestGpuVramGiB: number | null,
  totalGpuVramGiB: number | null,
  usableSystemRamGiB: number | null,
  hasServingRuntime: boolean
): WorkloadFitEstimate {
  const requiredGiB = estimateIntentRequiredGiB(intent);
  const workload = intent.workload ?? "requested workload";
  const validationNotes = [
    "This estimate uses the user-provided workload intent and remains approximate.",
    "Validate with the actual model, runtime, context length, batch size, and traffic pattern."
  ];

  if (intent.warnings.length) validationNotes.push(...intent.warnings);
  if (!hasServingRuntime && ["inference", "rag", "fine-tuning", "training"].includes(workload)) {
    validationNotes.push("No common production LLM serving/training runtime was detected; software setup may change the result.");
  }

  if (requiredGiB === null) {
    return {
      workload: `requested: ${workload}`,
      fitType: bestGpuVramGiB === null ? "cpu_only" : "full_gpu",
      confidence: "low",
      rationale: "This workload is not primarily sized by model VRAM in V1; CPU, RAM, storage, and network requirements should be validated directly.",
      validationNotes
    };
  }

  let fitType: WorkloadFitType = "not_recommended";
  if (bestGpuVramGiB !== null && bestGpuVramGiB >= requiredGiB) fitType = "full_gpu";
  else if (totalGpuVramGiB !== null && totalGpuVramGiB >= requiredGiB) fitType = "partial_offload";
  else if (bestGpuVramGiB !== null && usableSystemRamGiB !== null && bestGpuVramGiB + usableSystemRamGiB >= requiredGiB) fitType = "partial_offload";
  else if (bestGpuVramGiB === null && usableSystemRamGiB !== null && usableSystemRamGiB >= requiredGiB && intent.workload === "embeddings") fitType = "cpu_only";

  return {
    workload: `requested: ${workload}`,
    fitType,
    confidence: intent.modelSizeB ? "medium" : "low",
    rationale: `${formatIntent(intent)} maps to an approximate ${requiredGiB} GiB accelerator-memory planning band; detected best accelerator memory is ${bestGpuVramGiB === null ? "not available" : `${bestGpuVramGiB.toFixed(1)} GiB`}.`,
    validationNotes
  };
}

function rationaleFor(fitType: WorkloadFitType, band: WorkloadBand, bestGpuVramGiB: number | null): string {
  const gpu = bestGpuVramGiB === null ? "no accelerator memory" : `${bestGpuVramGiB.toFixed(1)} GiB best accelerator memory`;
  if (fitType === "full_gpu") return `Likely fits from a memory-class perspective with ${gpu}; validate real context and concurrency.`;
  if (fitType === "partial_offload") return `May fit with offload or multi-GPU planning, but ${gpu} is below the comfortable full-GPU band of about ${band.minFullGpuGiB} GiB.`;
  if (fitType === "cpu_only") return `Possible CPU-only path based on system RAM, but not a GPU-serving fit.`;
  if (fitType === "not_recommended" && bestGpuVramGiB === null) return "Not recommended from detected memory metadata; no GPU or accelerator memory was detected.";
  if (fitType === "not_recommended") return `Not recommended from detected memory metadata; ${gpu} is below the likely requirement band.`;
  return "Not enough information to estimate this workload.";
}

function defaultModelSizeFor(workload: WorkloadIntent["workload"]): number | null {
  if (workload === "embeddings") return 1;
  if (workload === "image" || workload === "video") return 8;
  if (workload === "inference" || workload === "rag" || workload === "fine-tuning" || workload === "training") return 7;
  return null;
}

function bytesPerParamFor(quantization: string | null): number {
  const q = quantization?.toLowerCase() ?? "q4";
  if (["q2", "q3"].some((prefix) => q.startsWith(prefix))) return 0.45;
  if (q.startsWith("q5")) return 0.7;
  if (q.startsWith("q6")) return 0.85;
  if (q.startsWith("q8") || q.includes("int8")) return 1.1;
  if (q.includes("fp16") || q.includes("bf16")) return 2.0;
  if (q.includes("fp32")) return 4.0;
  return 0.6;
}

function roundUpBand(value: number): number {
  const bands = [8, 12, 16, 24, 32, 40, 48, 64, 80, 96, 120, 141, 160, 240, 320, 640];
  return bands.find((band) => value <= band) ?? Math.ceil(value / 80) * 80;
}

function formatIntent(intent: WorkloadIntent): string {
  return [
    intent.workload ?? "unspecified workload",
    intent.modelSizeLabel,
    intent.concurrency !== "unknown" ? `${intent.concurrency} concurrency` : null,
    intent.contextTokens ? `${intent.contextTokens} context tokens` : null,
    intent.quantization
  ].filter(Boolean).join(", ");
}
