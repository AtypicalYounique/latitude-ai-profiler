export type Severity = "info" | "warning" | "critical";

export interface CollectorWarning {
  collector: string;
  message: string;
}

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  command: string;
}

export interface SystemInfo {
  osName: string | null;
  kernel: string | null;
  architecture: string | null;
  hostname: string | null;
  anonymized: boolean;
}

export interface CpuInfo {
  model: string | null;
  physicalCores: number | null;
  logicalThreads: number | null;
  sockets: number | null;
  currentMhz: number | null;
  maxMhz: number | null;
}

export interface MemoryInfo {
  totalBytes: number | null;
  availableBytes: number | null;
  swapTotalBytes: number | null;
  swapUsedBytes: number | null;
}

export interface GpuDevice {
  index: number;
  name: string | null;
  vendor?: "nvidia" | "apple" | "amd" | "intel" | "unknown";
  sharedMemory?: boolean;
  pciBusId: string | null;
  vramTotalMiB: number | null;
  vramUsedMiB: number | null;
  vramFreeMiB: number | null;
  utilizationGpuPercent: number | null;
  utilizationMemoryPercent: number | null;
  powerDrawWatts: number | null;
}

export interface GpuInfo {
  acceleratorPresent?: boolean;
  nvidiaPresent: boolean;
  driverVersion: string | null;
  cudaVersion: string | null;
  gpuCount: number;
  gpus: GpuDevice[];
}

export interface StorageMount {
  filesystem: string | null;
  mountpoint: string | null;
  type: string | null;
  sizeBytes: number | null;
  usedBytes: number | null;
  availableBytes: number | null;
  usePercent: number | null;
  deviceType: string | null;
}

export interface NetworkInfo {
  interfaces: Array<{
    name: string;
    state: string | null;
    speedMbps: number | null;
    addresses: string[];
  }>;
  defaultRouteInterface: string | null;
}

export interface DockerContainer {
  id: string;
  image: string;
  name: string | null;
  status: string;
  ports: string | null;
}

export interface DockerInfo {
  installed: boolean;
  daemonRunning: boolean;
  version: string | null;
  containers: DockerContainer[];
}

export interface KubernetesInfo {
  kubectlInstalled: boolean;
  currentContext: string | null;
  nodes: Array<{
    name: string;
    status: string | null;
    roles: string | null;
    version: string | null;
  }>;
}

export interface PythonPackage {
  name: string;
  version: string | null;
}

export interface PythonInfo {
  executable: string | null;
  version: string | null;
  packages: PythonPackage[];
}

export interface AiSoftwareInfo {
  binaries: Record<string, string | null>;
  packages: Record<string, string | null>;
  ncclVersion: string | null;
}

export interface UtilizationInfo {
  loadAverage: number[] | null;
  runningModelServers: string[];
}

export interface BenchmarkResults {
  approximate: true;
  disk?: {
    tempPath: string;
    writeMBps: number | null;
    readMBps: number | null;
  };
  cpu?: {
    operation: string;
    score: number | null;
    elapsedMs: number | null;
  };
  network?: Array<{
    host: string;
    latencyMs: number | null;
  }>;
  gpuSmoke?: {
    attempted: boolean;
    ok: boolean;
    message: string;
  };
}

export interface Bottleneck {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface Recommendation {
  currentFit: string[];
  likelyLimitations: string[];
  recommendedTargetClass: string;
  cheaperAlternative: string;
  performanceAlternative: string;
  confidence: "low" | "medium" | "high";
  validationQuestions: string[];
}

export type WorkloadKind =
  | "inference"
  | "embeddings"
  | "rag"
  | "fine-tuning"
  | "training"
  | "image"
  | "video"
  | "vector-db"
  | "orchestration"
  | "rpc"
  | "game-server"
  | "preprocessing";

export type ConcurrencyLevel = "low" | "medium" | "high" | "unknown";

export interface WorkloadIntent {
  workload: WorkloadKind | null;
  modelSizeLabel: string | null;
  modelSizeB: number | null;
  concurrency: ConcurrencyLevel;
  concurrencyRaw: string | null;
  contextTokens: number | null;
  quantization: string | null;
  warnings: string[];
}

export type WorkloadFitType = "full_gpu" | "partial_offload" | "cpu_only" | "not_recommended" | "unknown";

export interface WorkloadFitEstimate {
  workload: string;
  fitType: WorkloadFitType;
  confidence: "low" | "medium" | "high";
  rationale: string;
  validationNotes: string[];
}

export interface ModelFitSummary {
  inspiredBy: string;
  assumptions: string[];
  bestGpuVramGiB: number | null;
  totalGpuVramGiB: number | null;
  usableSystemRamGiB: number | null;
  intentFit?: WorkloadFitEstimate;
  workloads: WorkloadFitEstimate[];
}

export interface ScanReport {
  generatedAt: string;
  privacy: {
    anonymize: boolean;
    collected: string[];
    notCollected: string[];
  };
  system: SystemInfo;
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpu: GpuInfo;
  storage: StorageMount[];
  network: NetworkInfo;
  docker: DockerInfo;
  kubernetes: KubernetesInfo;
  python: PythonInfo;
  aiSoftware: AiSoftwareInfo;
  utilization: UtilizationInfo;
  workloadIntent: WorkloadIntent | null;
  warnings: CollectorWarning[];
  modelFit: ModelFitSummary;
  bottlenecks: Bottleneck[];
  recommendation: Recommendation;
  benchmarks?: BenchmarkResults;
}

export interface ScanOptions {
  anonymize: boolean;
  includeBenchmarks?: boolean;
  workloadIntent?: WorkloadIntent | null;
}
