import type { ConcurrencyLevel, WorkloadIntent, WorkloadKind } from "../types.js";
import { parseNumber } from "../utils/parse.js";

const WORKLOADS = new Set<WorkloadKind>([
  "inference",
  "embeddings",
  "rag",
  "fine-tuning",
  "training",
  "image",
  "video",
  "vector-db",
  "orchestration",
  "rpc",
  "game-server",
  "preprocessing"
]);

export interface WorkloadIntentInput {
  workload?: string;
  modelSize?: string;
  concurrency?: string;
  contextTokens?: string;
  quantization?: string;
}

export function parseWorkloadIntent(input: WorkloadIntentInput): WorkloadIntent | null {
  if (!input.workload && !input.modelSize && !input.concurrency && !input.contextTokens && !input.quantization) return null;

  const warnings: string[] = [];
  const workload = normalizeWorkload(input.workload, warnings);
  const modelSize = normalizeModelSize(input.modelSize, warnings);
  const concurrency = normalizeConcurrency(input.concurrency);
  const contextTokens = normalizeContextTokens(input.contextTokens, warnings);
  const quantization = input.quantization ? input.quantization.trim().toLowerCase() : null;

  return {
    workload,
    modelSizeLabel: modelSize.label,
    modelSizeB: modelSize.value,
    concurrency,
    concurrencyRaw: input.concurrency ?? null,
    contextTokens,
    quantization,
    warnings
  };
}

export function formatWorkloadIntent(intent: WorkloadIntent | null): string {
  if (!intent) return "not specified";
  const parts = [
    intent.workload,
    intent.modelSizeLabel,
    intent.concurrency !== "unknown" ? `${intent.concurrency} concurrency` : intent.concurrencyRaw,
    intent.contextTokens ? `${intent.contextTokens} context tokens` : null,
    intent.quantization
  ].filter(Boolean);
  return parts.join(", ") || "partially specified";
}

function normalizeWorkload(value: string | undefined, warnings: string[]): WorkloadKind | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  const aliases: Record<string, WorkloadKind> = {
    finetuning: "fine-tuning",
    "fine-tune": "fine-tuning",
    llm: "inference",
    serving: "inference",
    embedding: "embeddings",
    vectordb: "vector-db",
    "vector-db": "vector-db",
    vector: "vector-db",
    solana: "rpc",
    gaming: "game-server"
  };
  const candidate = aliases[normalized] ?? normalized;
  if (WORKLOADS.has(candidate as WorkloadKind)) return candidate as WorkloadKind;
  warnings.push(`Unknown workload "${value}" was kept as unspecified.`);
  return null;
}

function normalizeModelSize(value: string | undefined, warnings: string[]): { label: string | null; value: number | null } {
  if (!value) return { label: null, value: null };
  const trimmed = value.trim().toLowerCase();
  const numeric = parseNumber(trimmed);
  if (numeric === null) {
    warnings.push(`Could not parse model size "${value}". Use values like 7b, 13b, 70b, or 405b.`);
    return { label: value, value: null };
  }
  const sizeB = trimmed.includes("m") && !trimmed.includes("b") ? numeric / 1000 : numeric;
  return { label: `${stripTrailingZero(sizeB)}B`, value: sizeB };
}

function normalizeConcurrency(value: string | undefined): ConcurrencyLevel {
  if (!value) return "unknown";
  const normalized = value.trim().toLowerCase();
  if (["low", "small", "dev"].includes(normalized)) return "low";
  if (["medium", "moderate", "prod"].includes(normalized)) return "medium";
  if (["high", "large", "heavy", "production"].includes(normalized)) return "high";
  const numeric = parseNumber(normalized);
  if (numeric === null) return "unknown";
  if (numeric <= 4) return "low";
  if (numeric <= 32) return "medium";
  return "high";
}

function normalizeContextTokens(value: string | undefined, warnings: string[]): number | null {
  if (!value) return null;
  const parsed = parseNumber(value);
  if (parsed === null || parsed <= 0) {
    warnings.push(`Could not parse context token count "${value}".`);
    return null;
  }
  return Math.round(parsed);
}

function stripTrailingZero(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}
