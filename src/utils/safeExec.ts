import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandResult } from "../types.js";

const execFileAsync = promisify(execFile);

export async function safeExec(
  command: string,
  args: string[] = [],
  timeoutMs = 5000
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    return {
      ok: true,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      code: 0,
      command: [command, ...args].join(" ")
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | null;
    };
    return {
      ok: false,
      stdout: (err.stdout ?? "").trim(),
      stderr: (err.stderr ?? err.message ?? "").trim(),
      code: err.code ?? null,
      command: [command, ...args].join(" ")
    };
  }
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await safeExec("sh", ["-c", `command -v ${quote(command)}`], 2000);
  return result.ok && result.stdout.length > 0;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
