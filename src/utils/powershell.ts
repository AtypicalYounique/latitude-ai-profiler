import { safeExec } from "./safeExec.js";

export async function runPowerShellJson<T>(script: string, timeoutMs = 5000): Promise<T | null> {
  const result = await safeExec("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `${script} | ConvertTo-Json -Depth 6 -Compress`
  ], timeoutMs);
  if (!result.ok || !result.stdout) return null;
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    return null;
  }
}

export async function runPowerShellText(script: string, timeoutMs = 5000): Promise<string | null> {
  const result = await safeExec("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], timeoutMs);
  return result.ok && result.stdout ? result.stdout : null;
}
