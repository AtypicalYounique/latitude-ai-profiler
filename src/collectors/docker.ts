import type { CollectorWarning, DockerInfo } from "../types.js";
import { redactLocalIps } from "../utils/parse.js";
import { commandExists, safeExec } from "../utils/safeExec.js";

export async function collectDocker(anonymize: boolean, warnings: CollectorWarning[]): Promise<DockerInfo> {
  if (!(await commandExists("docker"))) return { installed: false, daemonRunning: false, version: null, containers: [] };

  const version = await safeExec("docker", ["--version"], 3000);
  const ps = await safeExec("docker", ["ps", "--format", "{{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}"], 5000);
  if (!ps.ok) {
    warnings.push({ collector: "docker", message: `docker daemon unavailable or permission denied: ${ps.stderr || "docker ps failed"}` });
    return { installed: true, daemonRunning: false, version: version.stdout || null, containers: [] };
  }

  return {
    installed: true,
    daemonRunning: true,
    version: version.stdout || null,
    containers: ps.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [id, image, name, status, ports] = line.split("\t");
        return {
          id,
          image,
          name: anonymize ? redactContainerName(name) : name,
          status,
          ports: ports ? (anonymize ? redactLocalIps(ports) : ports) : null
        };
      })
  };
}

function redactContainerName(name: string | undefined): string | null {
  if (!name) return null;
  return /^[a-z0-9_.-]{1,32}$/i.test(name) ? "[container-name]" : "[container-name]";
}
