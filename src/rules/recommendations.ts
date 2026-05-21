import type { Recommendation, ScanReport } from "../types.js";
import { profileName } from "./latitudeProfiles.js";
import { estimateIntentRequiredGiB } from "./modelFit.js";

export function recommend(profile: Omit<ScanReport, "recommendation">): Recommendation {
  const gpus = profile.gpu.gpus;
  const maxVram = Math.max(0, ...gpus.map((gpu) => gpu.vramTotalMiB ?? 0));
  const totalHighEnd = gpus.filter((gpu) => (gpu.vramTotalMiB ?? 0) >= 80 * 1024).length;
  const cpuThreads = profile.cpu.logicalThreads ?? 0;
  const hasGpu = gpus.length > 0 || Boolean(profile.gpu.acceleratorPresent);
  const hasNvidia = profile.gpu.nvidiaPresent;
  const hasSharedAccelerator = gpus.some((gpu) => gpu.sharedMemory);

  let target = "epyc-cpu";
  let cheaper = "epyc-cpu";
  let performance = "rtx-6000-ada";
  const fit: string[] = [];
  const limitations: string[] = [];

  if (!hasGpu) {
    fit.push("CPU orchestration", "RAG/vector DB", "API backends", "Solana/RPC", "game servers", "preprocessing");
    limitations.push("Not suitable for GPU inference or GPU fine-tuning without adding accelerators.");
    if (cpuThreads > 0 && cpuThreads < 16) limitations.push("CPU thread count is modest; validate orchestration and preprocessing needs.");
    target = "epyc-cpu";
    cheaper = "epyc-cpu";
    performance = "l40s";
  } else if (!hasNvidia) {
    fit.push("local AI development", "embeddings", "small quantized inference", "RAG prototyping", "shared-memory experimentation");
    limitations.push("Detected accelerator is not an NVIDIA CUDA data-center GPU; validate production serving on the target Linux/NVIDIA stack.");
    if (hasSharedAccelerator) limitations.push("Unified memory can help local model fit, but it is not equivalent to dedicated HBM/GDDR VRAM for production serving.");
    target = maxVram >= 24 * 1024 ? "l40s" : "rtx-6000-ada";
    cheaper = "rtx-6000-ada";
    performance = maxVram >= 70 * 1024 ? "h200-141gb" : "h100-80gb";
  } else if (gpus.length > 1 && totalHighEnd >= 2) {
    fit.push("multi-GPU serving", "large inference", "fine-tuning", "high concurrency");
    limitations.push("Should validate interconnect, storage throughput, and scheduler/runtime configuration.");
    target = "multi-node-gpu";
    cheaper = "h100-80gb";
    performance = "h200-141gb";
  } else if (maxVram >= 120 * 1024) {
    fit.push("memory-heavy inference", "larger context windows", "larger models", "higher throughput");
    target = "h200-141gb";
    cheaper = "h100-80gb";
    performance = "multi-node-gpu";
  } else if (maxVram >= 70 * 1024) {
    fit.push("large model inference", "high concurrency", "fine-tuning", "production serving");
    target = "h100-80gb";
    cheaper = "l40s";
    performance = "h200-141gb";
  } else if (maxVram >= 24 * 1024) {
    fit.push("small/medium inference", "embeddings", "image/video inference", "dev/test", "moderate production serving");
    limitations.push("Likely VRAM-limited for larger 70B-class unquantized inference or very large context windows.");
    target = "l40s";
    cheaper = "rtx-6000-ada";
    performance = "h100-80gb";
  } else {
    fit.push("small quantized models", "embeddings", "dev/test", "light image workloads");
    limitations.push("Likely VRAM-limited for medium and large production inference.");
    target = "rtx-6000-ada";
    cheaper = "epyc-cpu";
    performance = "l40s";
  }

  if (!profile.aiSoftware.packages.vllm && !profile.aiSoftware.packages.sglang && !profile.aiSoftware.packages["text-generation-inference"]) {
    limitations.push("Possible software optimization opportunity: no common LLM serving runtime was detected.");
  }
  if (profile.docker.installed === false) {
    limitations.push("Container runtime not detected, which may complicate repeatable production deployments.");
  }

  const intentTarget = targetForIntent(profile.workloadIntent);
  if (intentTarget) {
    target = intentTarget.target;
    cheaper = intentTarget.cheaper;
    performance = intentTarget.performance;
    fit.unshift(intentTarget.fit);
    limitations.unshift(intentTarget.limitation);
  }

  return {
    currentFit: fit,
    likelyLimitations: limitations.length ? limitations : ["No major limitation was inferred from metadata alone; validate with workload-specific testing."],
    recommendedTargetClass: profileName(target),
    cheaperAlternative: profileName(cheaper),
    performanceAlternative: profileName(performance),
    confidence: profile.workloadIntent?.modelSizeB || (hasNvidia && maxVram > 0) ? "medium" : "low",
    validationQuestions: [
      ...(profile.workloadIntent ? intentValidationQuestions(profile.workloadIntent) : []),
      "Which models, parameter sizes, and quantization formats are planned?",
      "What are the target latency, throughput, and concurrency requirements?",
      "How large are prompts, context windows, and expected KV cache pressure?",
      "Is this node serving inference, fine-tuning, preprocessing, vector DB, or orchestration?",
      "Will workloads run in Docker, Kubernetes, or a managed serving stack?",
      "What storage capacity, I/O, and private network requirements matter for production?"
    ]
  };
}

function targetForIntent(intent: ScanReport["workloadIntent"]): { target: string; cheaper: string; performance: string; fit: string; limitation: string } | null {
  if (!intent?.workload) return null;

  if (["orchestration", "rpc", "game-server", "preprocessing", "vector-db"].includes(intent.workload)) {
    return {
      target: "epyc-cpu",
      cheaper: "epyc-cpu",
      performance: "l40s",
      fit: `requested workload: ${intent.workload}`,
      limitation: "Workload intent is primarily CPU, RAM, storage, or network sensitive; GPU class should be validated only if inference is also in scope."
    };
  }

  const requiredGiB = estimateIntentRequiredGiB(intent);
  if (requiredGiB === null) return null;

  if (intent.workload === "fine-tuning" || intent.workload === "training") {
    if (requiredGiB <= 80) return intentTarget("h100-80gb", "l40s", "h200-141gb", intent, requiredGiB);
    if (requiredGiB <= 141) return intentTarget("h200-141gb", "h100-80gb", "multi-node-gpu", intent, requiredGiB);
    return intentTarget("multi-node-gpu", "h200-141gb", "multi-node-gpu", intent, requiredGiB);
  }

  if (intent.workload === "image" || intent.workload === "video") {
    if (requiredGiB <= 48) return intentTarget("l40s", "rtx-6000-ada", "h100-80gb", intent, requiredGiB);
    if (requiredGiB <= 80) return intentTarget("h100-80gb", "l40s", "h200-141gb", intent, requiredGiB);
    return intentTarget("h200-141gb", "h100-80gb", "multi-node-gpu", intent, requiredGiB);
  }

  if (requiredGiB <= 24) return intentTarget("rtx-6000-ada", "epyc-cpu", "l40s", intent, requiredGiB);
  if (requiredGiB <= 48) return intentTarget("l40s", "rtx-6000-ada", "h100-80gb", intent, requiredGiB);
  if (requiredGiB <= 80) return intentTarget("h100-80gb", "l40s", "h200-141gb", intent, requiredGiB);
  if (requiredGiB <= 141) return intentTarget("h200-141gb", "h100-80gb", "multi-node-gpu", intent, requiredGiB);
  return intentTarget("multi-node-gpu", "h200-141gb", "multi-node-gpu", intent, requiredGiB);
}

function intentTarget(
  target: string,
  cheaper: string,
  performance: string,
  intent: NonNullable<ScanReport["workloadIntent"]>,
  requiredGiB: number
): { target: string; cheaper: string; performance: string; fit: string; limitation: string } {
  return {
    target,
    cheaper,
    performance,
    fit: `requested workload: ${formatIntentShort(intent)}`,
    limitation: `Workload intent maps to an approximate ${requiredGiB} GiB accelerator-memory planning band; validate with the exact model, runtime, context, and traffic profile.`
  };
}

function intentValidationQuestions(intent: NonNullable<ScanReport["workloadIntent"]>): string[] {
  return [
    `For the requested workload (${formatIntentShort(intent)}), what is the acceptable p95 latency and peak concurrency?`,
    "Can the workload use quantization, batching, prefix caching, or shorter contexts if the cheaper class is preferred?"
  ];
}

function formatIntentShort(intent: NonNullable<ScanReport["workloadIntent"]>): string {
  return [
    intent.workload,
    intent.modelSizeLabel,
    intent.concurrency !== "unknown" ? `${intent.concurrency} concurrency` : null,
    intent.contextTokens ? `${intent.contextTokens} ctx` : null,
    intent.quantization
  ].filter(Boolean).join(", ");
}
