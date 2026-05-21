import type { AiSoftwareInfo, CollectorWarning, PythonInfo } from "../types.js";
import { commandExists, safeExec } from "../utils/safeExec.js";

const BINARIES: Record<string, string[]> = {
  docker: ["--version"],
  kubectl: ["version", "--client=true"],
  "nvidia-smi": ["--version"],
  nvcc: ["--version"],
  ollama: ["--version"],
  "llama-server": ["--version"],
  vllm: ["--version"]
};

const PACKAGE_ALIASES: Record<string, string[]> = {
  torch: ["torch"],
  transformers: ["transformers"],
  vllm: ["vllm"],
  llama_cpp: ["llama_cpp", "llama-cpp-python"],
  tensorrt_llm: ["tensorrt_llm"],
  "text-generation-inference": ["text-generation-inference"],
  sglang: ["sglang"],
  triton: ["triton"],
  "flash-attn": ["flash-attn"],
  tensorflow: ["tensorflow"],
  deepspeed: ["deepspeed"],
  accelerate: ["accelerate"],
  peft: ["peft"],
  bitsandbytes: ["bitsandbytes"],
  xformers: ["xformers"]
};

export async function collectAiSoftware(python: PythonInfo, warnings: CollectorWarning[]): Promise<AiSoftwareInfo> {
  const binaries: Record<string, string | null> = {};
  for (const [binary, args] of Object.entries(BINARIES)) {
    if (!(await commandExists(binary))) {
      binaries[binary] = null;
      continue;
    }
    const version = await safeExec(binary, args, 4000);
    binaries[binary] = version.ok ? firstLine(version.stdout || version.stderr) : "installed";
  }

  const packages: Record<string, string | null> = {};
  for (const [canonical, aliases] of Object.entries(PACKAGE_ALIASES)) {
    const found = python.packages.find((pkg) => aliases.includes(pkg.name));
    packages[canonical] = found?.version ?? null;
  }

  const ncclVersion = await detectNccl(python.executable, warnings);
  return { binaries, packages, ncclVersion };
}

async function detectNccl(pythonExecutable: string | null, warnings: CollectorWarning[]): Promise<string | null> {
  if (!pythonExecutable) return null;
  const result = await safeExec(pythonExecutable, [
    "-c",
    "import torch; print(torch.cuda.nccl.version() if torch.cuda.is_available() and hasattr(torch.cuda, 'nccl') else '')"
  ], 5000);
  if (!result.ok) return null;
  const value = result.stdout.trim();
  if (!value) return null;
  if (/^[\d, ().]+$/.test(value)) return value;
  warnings.push({ collector: "aiSoftware", message: "NCCL version returned an unexpected value and was ignored" });
  return null;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).find(Boolean)?.trim() ?? "installed";
}
