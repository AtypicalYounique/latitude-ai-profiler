import type { CollectorWarning, KubernetesInfo } from "../types.js";
import { commandExists, safeExec } from "../utils/safeExec.js";

export async function collectKubernetes(warnings: CollectorWarning[]): Promise<KubernetesInfo> {
  if (!(await commandExists("kubectl"))) return { kubectlInstalled: false, currentContext: null, nodes: [] };

  const context = await safeExec("kubectl", ["config", "current-context"], 3000);
  const nodes = await safeExec("kubectl", ["get", "nodes", "--no-headers"], 5000);
  if (!nodes.ok) {
    warnings.push({ collector: "kubernetes", message: `kubectl node access unavailable or denied: ${nodes.stderr || "kubectl get nodes failed"}` });
    return { kubectlInstalled: true, currentContext: context.ok ? context.stdout : null, nodes: [] };
  }

  return {
    kubectlInstalled: true,
    currentContext: context.ok ? context.stdout : null,
    nodes: nodes.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const cols = line.trim().split(/\s+/);
        return { name: cols[0], status: cols[1] ?? null, roles: cols[2] ?? null, version: cols[4] ?? null };
      })
  };
}
