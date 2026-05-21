import { safeExec } from "./safeExec.js";
import type { CollectorWarning } from "../types.js";

export async function runCollectorCommand(
  collector: string,
  warnings: CollectorWarning[],
  command: string,
  args: string[] = [],
  timeoutMs = 5000
): Promise<string | null> {
  const result = await safeExec(command, args, timeoutMs);
  if (!result.ok) {
    warnings.push({
      collector,
      message: `${result.command} unavailable or failed${result.stderr ? `: ${result.stderr}` : ""}`
    });
    return null;
  }
  return result.stdout;
}
