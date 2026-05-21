import type { BenchmarkResults } from "../types.js";
import { safeExec } from "../utils/safeExec.js";

export async function runGpuSmoke(pythonExecutable: string | null): Promise<NonNullable<BenchmarkResults["gpuSmoke"]>> {
  if (!pythonExecutable) return { attempted: false, ok: false, message: "Python not detected" };
  const torchCheck = await safeExec(pythonExecutable, ["-c", "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('torch') else 1)"], 5000);
  if (!torchCheck.ok) return { attempted: false, ok: false, message: "PyTorch not installed; GPU smoke test skipped" };

  const code = [
    "import torch",
    "raise SystemExit('CUDA unavailable in PyTorch') if not torch.cuda.is_available() else None",
    "x=torch.rand((1024,1024), device='cuda')",
    "y=x @ x",
    "torch.cuda.synchronize()",
    "print(str(y.shape))"
  ].join("; ");
  const result = await safeExec(pythonExecutable, ["-c", code], 10000);
  return {
    attempted: true,
    ok: result.ok,
    message: result.ok ? "PyTorch CUDA smoke test completed" : oneLine(result.stderr || "PyTorch CUDA smoke test failed")
  };
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
