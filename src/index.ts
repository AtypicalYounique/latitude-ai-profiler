import type { BenchmarkResults, CollectorWarning, ScanOptions, ScanReport } from "./types.js";
import { collectAiSoftware } from "./collectors/aiSoftware.js";
import { collectCpu } from "./collectors/cpu.js";
import { collectDocker } from "./collectors/docker.js";
import { collectGpu } from "./collectors/gpu.js";
import { collectKubernetes } from "./collectors/kubernetes.js";
import { collectMemory } from "./collectors/memory.js";
import { collectNetwork } from "./collectors/network.js";
import { collectPython } from "./collectors/python.js";
import { collectStorage } from "./collectors/storage.js";
import { collectSystem } from "./collectors/system.js";
import { collectUtilization } from "./collectors/utilization.js";
import { runCpuBenchmark } from "./benchmarks/cpu.js";
import { runDiskBenchmark } from "./benchmarks/disk.js";
import { runGpuSmoke } from "./benchmarks/gpuSmoke.js";
import { runNetworkBenchmark } from "./benchmarks/network.js";
import { inferBottlenecks } from "./rules/bottlenecks.js";
import { estimateModelFit } from "./rules/modelFit.js";
import { recommend } from "./rules/recommendations.js";
import { inferSoftwareWarnings } from "./rules/softwareWarnings.js";
import { anonymizeText } from "./utils/parse.js";

const PRIVACY_COLLECTED = [
  "hardware metadata",
  "OS/kernel metadata",
  "GPU utilization and memory metadata",
  "disk capacity metadata",
  "network interface basics",
  "installed tool and package versions",
  "running container image/status metadata",
  "optional user-provided workload intent metadata"
];

const PRIVACY_NOT_COLLECTED = [
  "source code",
  "prompts",
  "datasets",
  "model weights",
  "environment variables",
  "secrets",
  "API keys",
  "SSH keys",
  "customer files",
  "private application data",
  "container environment variables",
  "Kubernetes secrets/configmaps",
  "application logs"
];

export async function scan(options: ScanOptions): Promise<ScanReport> {
  const warnings: CollectorWarning[] = [];
  const system = await collectSystem(options.anonymize, warnings);
  const cpu = await collectCpu(warnings);
  const memory = await collectMemory(warnings);
  const gpu = await collectGpu(warnings);
  const storage = await collectStorage(warnings);
  const network = await collectNetwork(options.anonymize, warnings);
  const docker = await collectDocker(options.anonymize, warnings);
  const kubernetes = await collectKubernetes(warnings);
  const python = await collectPython(warnings);
  const aiSoftware = await collectAiSoftware(python, warnings);
  const utilization = await collectUtilization(docker, warnings);
  const modelFit = estimateModelFit({ cpu, memory, gpu, aiSoftware }, options.workloadIntent ?? null);
  const sanitizedWarnings = options.anonymize
    ? warnings.map((warning) => ({ ...warning, message: normalizeWarning(anonymizeText(warning.message)) }))
    : warnings.map((warning) => ({ ...warning, message: normalizeWarning(warning.message) }));

  const base = {
    generatedAt: new Date().toISOString(),
    privacy: {
      anonymize: options.anonymize,
      collected: PRIVACY_COLLECTED,
      notCollected: PRIVACY_NOT_COLLECTED
    },
    system,
    cpu,
    memory,
    gpu,
    storage,
    network,
    docker,
    kubernetes,
    python,
    aiSoftware,
    utilization,
    workloadIntent: options.workloadIntent ?? null,
    modelFit,
    warnings: sanitizedWarnings
  };

  const bottlenecks = [...inferBottlenecks(base), ...inferSoftwareWarnings(base)];
  const reportWithoutRecommendation = { ...base, bottlenecks };
  const recommendation = recommend(reportWithoutRecommendation);
  const report: ScanReport = { ...reportWithoutRecommendation, recommendation };

  if (options.includeBenchmarks) {
    report.benchmarks = await benchmark({ pythonExecutable: python.executable });
  }

  return report;
}

function normalizeWarning(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export async function benchmark(options: { pythonExecutable?: string | null; hosts?: string[] } = {}): Promise<BenchmarkResults> {
  const hosts = options.hosts ?? ["1.1.1.1", "8.8.8.8"];
  const [disk, cpu, network, gpuSmoke] = await Promise.all([
    runDiskBenchmark(),
    runCpuBenchmark(),
    runNetworkBenchmark(hosts),
    runGpuSmoke(options.pythonExecutable ?? "python3")
  ]);
  return { approximate: true, disk, cpu, network, gpuSmoke };
}
