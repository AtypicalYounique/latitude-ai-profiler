import type { CollectorWarning, PythonInfo, PythonPackage } from "../types.js";
import { commandExists, safeExec } from "../utils/safeExec.js";

const AI_PACKAGES = [
  "torch",
  "transformers",
  "vllm",
  "llama_cpp",
  "llama-cpp-python",
  "tensorrt_llm",
  "text-generation-inference",
  "sglang",
  "triton",
  "flash-attn",
  "tensorflow",
  "deepspeed",
  "accelerate",
  "peft",
  "bitsandbytes",
  "xformers"
];

export async function collectPython(warnings: CollectorWarning[]): Promise<PythonInfo> {
  const executable = (await firstExisting(["python3", "python"])) ?? null;
  if (!executable) return { executable: null, version: null, packages: [] };

  const version = await safeExec(executable, ["--version"], 3000);
  if (!version.ok) warnings.push({ collector: "python", message: `${executable} --version failed` });

  const packages: PythonPackage[] = [];
  for (const pkg of AI_PACKAGES) {
    const result = await safeExec(executable, ["-m", "pip", "show", pkg], 3000);
    if (!result.ok) continue;
    const match = result.stdout.match(/^Version:\s*(.+)$/m);
    packages.push({ name: pkg, version: match?.[1]?.trim() ?? null });
  }

  return { executable, version: version.stdout || version.stderr || null, packages };
}

async function firstExisting(commands: string[]): Promise<string | undefined> {
  for (const command of commands) {
    if (await commandExists(command)) return command;
  }
  return undefined;
}
