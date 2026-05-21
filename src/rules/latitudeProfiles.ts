export interface LatitudeProfile {
  id: string;
  name: string;
  bestFor: string[];
  summary: string;
}

export const LATITUDE_PROFILES: LatitudeProfile[] = [
  {
    id: "epyc-cpu",
    name: "AMD EPYC CPU bare metal",
    bestFor: ["Solana/RPC", "game servers", "API backends", "RAG orchestration", "vector DBs", "preprocessing", "CPU-bound inference"],
    summary: "High-core CPU infrastructure for orchestration, storage-heavy services, and CPU-bound workloads."
  },
  {
    id: "rtx-6000-ada",
    name: "RTX 6000 Ada class",
    bestFor: ["small/medium inference", "embeddings", "dev/test", "image workloads", "moderate VRAM needs"],
    summary: "Flexible single-node GPU class for moderate inference and development workloads."
  },
  {
    id: "l40s",
    name: "L40S class",
    bestFor: ["production inference for smaller/medium models", "image/video inference", "efficient GPU serving"],
    summary: "Efficient production GPU serving class for medium inference and visual AI workloads."
  },
  {
    id: "h100-80gb",
    name: "H100 80GB class",
    bestFor: ["large model inference", "high concurrency", "fine-tuning", "production AI workloads"],
    summary: "High-end accelerator class for large inference, fine-tuning, and demanding production serving."
  },
  {
    id: "h200-141gb",
    name: "H200 141GB class",
    bestFor: ["larger context windows", "memory-heavy inference", "larger models", "higher throughput"],
    summary: "Memory-rich accelerator class for larger contexts, heavier KV cache, and high-throughput inference."
  },
  {
    id: "multi-node-gpu",
    name: "Multi-node GPU cluster",
    bestFor: ["distributed training", "very large inference", "100B+ model class", "high concurrency", "multi-GPU serving"],
    summary: "Cluster class for distributed training and very large inference footprints."
  }
];

export function profileName(id: string): string {
  return LATITUDE_PROFILES.find((profile) => profile.id === id)?.name ?? id;
}
