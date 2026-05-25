import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { scan } from "../index.js";
import type { ScanReport } from "../types.js";
import { safeExec } from "../utils/safeExec.js";
import { VERSION } from "../version.js";

const PROMPTS: Record<string, string> = {
  short_prose: "Explain how neural networks work in 144-200 words.",
  code_gen: "Write a Python function that implements a binary search tree with insert, delete, and search methods. Include docstrings and type hints.",
  reasoning: "A train leaves Station A at 9:00 AM traveling east at 60 mph. Another train leaves Station B, 300 miles east of A, at 9:30 AM traveling west at 80 mph. At what time and how far from Station A do they meet? Show your reasoning.",
  structured: "Return a JSON object describing a fictional book with fields: title, author, year, genre, isbn, and a chapters array with five entries.",
  long_context: "Summarize the key innovations of the transformer architecture, including self-attention, multi-head attention, positional encoding, layer normalization, residual connections, and the encoder-decoder structure."
};

const SPEC_DRAFT_COUNTERS = [
  "vllm:spec_decode_num_draft_tokens_total",
  "vllm:spec_decode_num_drafts_total"
];

const SPEC_ACCEPTED_COUNTERS = [
  "vllm:spec_decode_num_accepted_tokens_total"
];

export interface VllmBundleOptions {
  yes?: boolean;
  out?: string;
  label?: string;
  endpoint?: string;
  model?: string;
  container?: string;
  command?: string;
  runs?: string | number;
  warmupRuns?: string | number;
  maxTokens?: string | number;
  skipBenchmark?: boolean;
  anonymize?: boolean;
}

interface CompletionRun {
  prompt: string;
  run: number;
  ok: boolean;
  error?: string;
  ttftMs: number | null;
  totalMs: number | null;
  tpotMs: number | null;
  decodeTps: number | null;
  totalTps: number | null;
  completionTokens: number | null;
}

interface PromptSummary {
  runs: CompletionRun[];
  median: MetricSummary | null;
  p95: MetricSummary | null;
}

interface MetricSummary {
  ttftMs: number | null;
  tpotMs: number | null;
  decodeTps: number | null;
  totalTps: number | null;
  completionTokens: number | null;
}

interface BenchmarkJson {
  status: "PASS" | "PARTIAL" | "FAILED" | "SKIPPED";
  errors: string[];
  run: {
    label: string;
    timestampUtc: string;
    endTimestampUtc: string | null;
    elapsedSeconds: number | null;
    runs: number;
    warmupRuns: number;
    maxTokens: number;
    promptsHash: string;
  };
  environment: {
    endpoint: string;
    model: string | null;
    vllmVersion: string | null;
  };
  prompts: Record<string, PromptSummary>;
  aggregate: {
    decodeTpsMeanOfMedians: number | null;
    decodeTpsMinMedian: number | null;
    decodeTpsMaxMedian: number | null;
  };
  specDecode: SpecDecodeSummary;
}

interface SpecDecodeSummary {
  draftCounter: string | null;
  acceptedCounter: string | null;
  draftStart: number | null;
  draftEnd: number | null;
  draftDelta: number | null;
  acceptedStart: number | null;
  acceptedEnd: number | null;
  acceptedDelta: number | null;
  acceptanceRate: number | null;
}

interface DockerImageEvidence {
  captured: boolean;
  error: string | null;
  container: string | null;
  containerId: string | null;
  imageRef: string | null;
  imageId: string | null;
  imageDigest: string | null;
  startedAt: string | null;
  args: string[] | null;
}

export async function createVllmBenchmarkBundle(options: VllmBundleOptions): Promise<{ runDir: string; readme: string; summary: BenchmarkJson }> {
  const startedAt = new Date();
  const endpoint = normalizeEndpoint(options.endpoint ?? "http://localhost:8000");
  const label = sanitizeLabel(options.label ?? "vllm");
  const runs = parsePositiveInt(options.runs, 3, "runs");
  const warmupRuns = parsePositiveInt(options.warmupRuns, 1, "warmup-runs");
  const maxTokens = parsePositiveInt(options.maxTokens, 128, "max-tokens");
  const outDir = resolve(options.out ?? "benchmark-runs");
  const runDir = join(outDir, `${timestampForPath(startedAt)}_${label}`);

  await mkdir(runDir, { recursive: true });

  const runConfig = {
    profilerVersion: VERSION,
    runtime: "vllm",
    generatedAt: startedAt.toISOString(),
    endpoint,
    label,
    model: options.model ?? null,
    container: options.container ?? null,
    command: options.command ?? null,
    runs,
    warmupRuns,
    maxTokens,
    skipBenchmark: Boolean(options.skipBenchmark),
    anonymize: Boolean(options.anonymize),
    privacyNote: "Synthetic benchmark prompts only. No source code, customer prompts, datasets, model weights, environment variables, secrets, or customer files are collected. If --container is provided, docker logs are captured as boot.log; review logs before sharing externally."
  };
  await writeJson(join(runDir, "run_config.json"), runConfig);
  await writeFile(join(runDir, "command.txt"), `${options.command ?? "not provided"}\n`, "utf8");

  const report = await scan({ anonymize: Boolean(options.anonymize), includeBenchmarks: false });
  await writeJson(join(runDir, "hardware_profile.json"), hardwareProfile(report));
  await writeJson(join(runDir, "software_versions.json"), softwareVersions(report));
  await captureNvidiaSmi(join(runDir, "nvidia_smi_pre.txt"));

  const dockerEvidence = await captureDockerEvidence(options.container ?? null, join(runDir, "boot.log"));
  await writeJson(join(runDir, "docker_image.json"), dockerEvidence);
  await writeJson(join(runDir, "boot_meta.json"), {
    capturedAt: new Date().toISOString(),
    endpoint,
    container: dockerEvidence,
    health: await fetchJsonOrText(`${endpoint}/health`),
    version: await fetchJsonOrText(`${endpoint}/version`),
    models: await fetchJsonOrText(`${endpoint}/v1/models`)
  });

  const metricsStart = await fetchTextOrNote(`${endpoint}/metrics`);
  await writeFile(join(runDir, "metrics_start.txt"), metricsStart, "utf8");

  let model = options.model ?? (await resolveModel(endpoint));
  const vllmVersion = await resolveVllmVersion(endpoint);
  const benchmarkStarted = Date.now();
  const benchmark = options.skipBenchmark
    ? skippedBenchmark(label, endpoint, model, startedAt, runs, warmupRuns, maxTokens)
    : await runBenchmark({ endpoint, model, label, runs, warmupRuns, maxTokens, startedAt, vllmVersion });

  const metricsEnd = await fetchTextOrNote(`${endpoint}/metrics`);
  await writeFile(join(runDir, "metrics_end.txt"), metricsEnd, "utf8");
  benchmark.specDecode = computeSpecDecode(metricsStart, metricsEnd);
  benchmark.run.endTimestampUtc = new Date().toISOString();
  benchmark.run.elapsedSeconds = Math.round((Date.now() - benchmarkStarted) / 1000);

  await writeFile(join(runDir, "benchmark_result.txt"), renderBenchmarkText(benchmark), "utf8");
  await writeJson(join(runDir, "benchmark_result.json"), benchmark);
  await writeJson(join(runDir, "summary.json"), {
    status: benchmark.status,
    runDir,
    endpoint,
    model,
    dockerImageDigest: dockerEvidence.imageDigest,
    aggregate: benchmark.aggregate,
    specDecode: benchmark.specDecode,
    errors: benchmark.errors
  });

  const readme = renderBundleReadme({ runDir, report, benchmark, dockerEvidence, runConfig });
  await writeFile(join(runDir, "README.md"), readme, "utf8");
  return { runDir, readme, summary: benchmark };
}

function hardwareProfile(report: ScanReport): object {
  return {
    generatedAt: report.generatedAt,
    system: report.system,
    cpu: report.cpu,
    memory: report.memory,
    gpu: report.gpu,
    storage: report.storage,
    network: report.network,
    recommendation: report.recommendation
  };
}

function softwareVersions(report: ScanReport): object {
  return {
    generatedAt: report.generatedAt,
    system: report.system,
    docker: report.docker,
    kubernetes: report.kubernetes,
    python: report.python,
    aiSoftware: report.aiSoftware,
    utilization: report.utilization,
    warnings: report.warnings
  };
}

async function captureNvidiaSmi(path: string): Promise<void> {
  const result = await safeExec("nvidia-smi", [], 5000);
  await writeFile(path, result.ok ? `${result.stdout}\n` : `nvidia-smi unavailable or failed: ${result.stderr || result.stdout || "unknown error"}\n`, "utf8");
}

async function captureDockerEvidence(container: string | null, bootLogPath: string): Promise<DockerImageEvidence> {
  if (!container) {
    await writeFile(bootLogPath, "Docker container not specified; boot log was not captured. Pass --container <name-or-id> to capture docker logs and image provenance.\n", "utf8");
    return {
      captured: false,
      error: "container not specified",
      container: null,
      containerId: null,
      imageRef: null,
      imageId: null,
      imageDigest: null,
      startedAt: null,
      args: null
    };
  }

  const logs = await safeExec("docker", ["logs", "--tail", "5000", container], 15000);
  await writeFile(bootLogPath, logs.ok ? `${logs.stdout}${logs.stderr ? `\n${logs.stderr}` : ""}\n` : `docker logs failed: ${logs.stderr || logs.stdout || "unknown error"}\n`, "utf8");

  const inspect = await safeExec("docker", ["inspect", container], 10000);
  if (!inspect.ok) {
    return {
      captured: false,
      error: inspect.stderr || inspect.stdout || "docker inspect failed",
      container,
      containerId: null,
      imageRef: null,
      imageId: null,
      imageDigest: null,
      startedAt: null,
      args: null
    };
  }

  try {
    const parsed = JSON.parse(inspect.stdout) as Array<{
      Id?: string;
      Image?: string;
      Config?: { Image?: string; ArgsEscaped?: boolean; Cmd?: string[] };
      Args?: string[];
      State?: { StartedAt?: string };
    }>;
    const c = parsed[0] ?? {};
    const imageDigest = c.Image ? await resolveImageDigest(c.Image) : null;
    return {
      captured: true,
      error: null,
      container,
      containerId: c.Id ?? null,
      imageRef: c.Config?.Image ?? null,
      imageId: c.Image ?? null,
      imageDigest,
      startedAt: c.State?.StartedAt ?? null,
      args: c.Args ?? c.Config?.Cmd ?? null
    };
  } catch (error) {
    return {
      captured: false,
      error: `docker inspect parse failed: ${error instanceof Error ? error.message : String(error)}`,
      container,
      containerId: null,
      imageRef: null,
      imageId: null,
      imageDigest: null,
      startedAt: null,
      args: null
    };
  }
}

async function resolveImageDigest(imageId: string): Promise<string | null> {
  const inspect = await safeExec("docker", ["inspect", imageId], 10000);
  if (!inspect.ok) return null;
  try {
    const parsed = JSON.parse(inspect.stdout) as Array<{ RepoDigests?: string[] }>;
    return parsed[0]?.RepoDigests?.[0] ?? null;
  } catch {
    return null;
  }
}

async function resolveModel(endpoint: string): Promise<string | null> {
  const data = await fetchJsonOrText(`${endpoint}/v1/models`);
  if (typeof data.body === "object" && data.body && "data" in data.body) {
    const models = (data.body as { data?: Array<{ id?: string }> }).data;
    return models?.find((model) => typeof model.id === "string")?.id ?? null;
  }
  return null;
}

async function resolveVllmVersion(endpoint: string): Promise<string | null> {
  const data = await fetchJsonOrText(`${endpoint}/version`);
  if (typeof data.body === "object" && data.body && "version" in data.body) {
    const version = (data.body as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  }
  return null;
}

async function runBenchmark(args: {
  endpoint: string;
  model: string | null;
  label: string;
  runs: number;
  warmupRuns: number;
  maxTokens: number;
  startedAt: Date;
  vllmVersion: string | null;
}): Promise<BenchmarkJson> {
  const errors: string[] = [];
  const prompts: Record<string, PromptSummary> = {};
  if (!args.model) {
    errors.push("No model was provided and /v1/models did not return a usable model id.");
  }

  for (const [name, prompt] of Object.entries(PROMPTS)) {
    prompts[name] = { runs: [], median: null, p95: null };
    if (!args.model) continue;
    for (let i = 0; i < args.warmupRuns; i += 1) {
      await runCompletion(args.endpoint, args.model, prompt, args.maxTokens, -1).catch(() => null);
    }
    for (let i = 1; i <= args.runs; i += 1) {
      const run = await runCompletion(args.endpoint, args.model, prompt, args.maxTokens, i);
      prompts[name].runs.push(run);
      if (!run.ok && run.error) errors.push(`${name} run ${i}: ${run.error}`);
    }
    prompts[name].median = summarizeRuns(prompts[name].runs, 50);
    prompts[name].p95 = summarizeRuns(prompts[name].runs, 95);
  }

  const medians = Object.values(prompts)
    .map((prompt) => prompt.median?.decodeTps)
    .filter((value): value is number => typeof value === "number");

  return {
    status: errors.length === 0 ? "PASS" : medians.length > 0 ? "PARTIAL" : "FAILED",
    errors,
    run: {
      label: args.label,
      timestampUtc: args.startedAt.toISOString(),
      endTimestampUtc: null,
      elapsedSeconds: null,
      runs: args.runs,
      warmupRuns: args.warmupRuns,
      maxTokens: args.maxTokens,
      promptsHash: promptsHash()
    },
    environment: {
      endpoint: args.endpoint,
      model: args.model,
      vllmVersion: args.vllmVersion
    },
    prompts,
    aggregate: aggregateMedians(medians),
    specDecode: emptySpecDecode()
  };
}

async function runCompletion(endpoint: string, model: string, prompt: string, maxTokens: number, run: number): Promise<CompletionRun> {
  const started = performance.now();
  let firstTokenAt: number | null = null;
  let lastTokenAt: number | null = null;
  let completionTokens = 0;
  let textChunks = 0;

  try {
    const response = await fetch(`${endpoint}/v1/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        max_tokens: maxTokens,
        temperature: 0,
        stream: true,
        stream_options: { include_usage: true }
      })
    });
    if (!response.ok) {
      return failedRun(prompt, run, `HTTP ${response.status}: ${await response.text().catch(() => response.statusText)}`);
    }
    if (!response.body) {
      return failedRun(prompt, run, "response body was empty");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const body = trimmed.slice(6);
        if (body === "[DONE]") continue;
        let parsed: {
          choices?: Array<{ text?: string }>;
          usage?: { completion_tokens?: number };
        };
        try {
          parsed = JSON.parse(body) as typeof parsed;
        } catch {
          continue;
        }
        if (parsed.usage?.completion_tokens) completionTokens = parsed.usage.completion_tokens;
        const text = parsed.choices?.[0]?.text ?? "";
        if (text.length > 0) {
          const now = performance.now();
          firstTokenAt ??= now;
          lastTokenAt = now;
          textChunks += 1;
        }
      }
    }

    const ended = performance.now();
    const tokens = completionTokens || textChunks || null;
    const decodeMs = firstTokenAt && lastTokenAt ? Math.max(lastTokenAt - firstTokenAt, 0) : null;
    const totalMs = ended - started;
    return {
      prompt,
      run,
      ok: true,
      ttftMs: firstTokenAt ? round(firstTokenAt - started, 2) : null,
      totalMs: round(totalMs, 2),
      tpotMs: decodeMs && tokens && tokens > 1 ? round(decodeMs / Math.max(tokens - 1, 1), 2) : null,
      decodeTps: decodeMs && tokens && decodeMs > 0 ? round((Math.max(tokens - 1, 1) / decodeMs) * 1000, 2) : null,
      totalTps: tokens && totalMs > 0 ? round((tokens / totalMs) * 1000, 2) : null,
      completionTokens: tokens
    };
  } catch (error) {
    return failedRun(prompt, run, error instanceof Error ? error.message : String(error));
  }
}

function failedRun(prompt: string, run: number, error: string): CompletionRun {
  return {
    prompt,
    run,
    ok: false,
    error,
    ttftMs: null,
    totalMs: null,
    tpotMs: null,
    decodeTps: null,
    totalTps: null,
    completionTokens: null
  };
}

function summarizeRuns(runs: CompletionRun[], percentile: number): MetricSummary | null {
  const okRuns = runs.filter((run) => run.ok && run.decodeTps !== null);
  if (okRuns.length === 0) return null;
  return {
    ttftMs: percentileValue(okRuns.map((run) => run.ttftMs), percentile),
    tpotMs: percentileValue(okRuns.map((run) => run.tpotMs), percentile),
    decodeTps: percentileValue(okRuns.map((run) => run.decodeTps), percentile),
    totalTps: percentileValue(okRuns.map((run) => run.totalTps), percentile),
    completionTokens: percentileValue(okRuns.map((run) => run.completionTokens), percentile)
  };
}

function percentileValue(values: Array<number | null>, percentile: number): number | null {
  const sorted = values.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(((percentile / 100) * (sorted.length - 1)))));
  return round(sorted[index], 2);
}

function aggregateMedians(medians: number[]): BenchmarkJson["aggregate"] {
  if (medians.length === 0) {
    return { decodeTpsMeanOfMedians: null, decodeTpsMinMedian: null, decodeTpsMaxMedian: null };
  }
  return {
    decodeTpsMeanOfMedians: round(medians.reduce((sum, value) => sum + value, 0) / medians.length, 2),
    decodeTpsMinMedian: round(Math.min(...medians), 2),
    decodeTpsMaxMedian: round(Math.max(...medians), 2)
  };
}

function computeSpecDecode(startText: string, endText: string): SpecDecodeSummary {
  const start = parsePrometheusMetrics(startText);
  const end = parsePrometheusMetrics(endText);
  const draftCounter = SPEC_DRAFT_COUNTERS.find((name) => start.has(name) || end.has(name)) ?? null;
  const acceptedCounter = SPEC_ACCEPTED_COUNTERS.find((name) => start.has(name) || end.has(name)) ?? null;
  const draftStart = draftCounter ? start.get(draftCounter) ?? 0 : null;
  const draftEnd = draftCounter ? end.get(draftCounter) ?? 0 : null;
  const acceptedStart = acceptedCounter ? start.get(acceptedCounter) ?? 0 : null;
  const acceptedEnd = acceptedCounter ? end.get(acceptedCounter) ?? 0 : null;
  const draftDelta = draftStart !== null && draftEnd !== null ? draftEnd - draftStart : null;
  const acceptedDelta = acceptedStart !== null && acceptedEnd !== null ? acceptedEnd - acceptedStart : null;
  return {
    draftCounter,
    acceptedCounter,
    draftStart,
    draftEnd,
    draftDelta,
    acceptedStart,
    acceptedEnd,
    acceptedDelta,
    acceptanceRate: draftDelta && draftDelta > 0 && acceptedDelta !== null ? round((acceptedDelta / draftDelta) * 100, 2) : null
  };
}

function parsePrometheusMetrics(text: string): Map<string, number> {
  const metrics = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?)$/i.exec(trimmed);
    if (!match) continue;
    const current = metrics.get(match[1]) ?? 0;
    metrics.set(match[1], current + Number(match[2]));
  }
  return metrics;
}

function renderBenchmarkText(benchmark: BenchmarkJson): string {
  const lines: string[] = [];
  lines.push("Latitude AI Profiler vLLM Benchmark");
  lines.push(`status: ${benchmark.status}`);
  lines.push(`label: ${benchmark.run.label}`);
  lines.push(`timestamp_utc: ${benchmark.run.timestampUtc}`);
  lines.push(`endpoint: ${benchmark.environment.endpoint}`);
  lines.push(`model: ${benchmark.environment.model ?? "unknown"}`);
  lines.push(`vllm_version: ${benchmark.environment.vllmVersion ?? "unknown"}`);
  lines.push(`num_runs: ${benchmark.run.runs} (+${benchmark.run.warmupRuns} warmup)`);
  lines.push(`max_tokens: ${benchmark.run.maxTokens}`);
  lines.push(`prompts_hash: ${benchmark.run.promptsHash}`);
  lines.push("");
  lines.push("prompt ttft_ms tpot_ms decode_tps total_tps tokens");
  for (const [name, prompt] of Object.entries(benchmark.prompts)) {
    for (const run of prompt.runs) {
      if (!run.ok) {
        lines.push(`${name} ERROR ${run.error ?? "unknown error"} (run ${run.run})`);
        continue;
      }
      lines.push(`${name} ${fmt(run.ttftMs)} ${fmt(run.tpotMs)} ${fmt(run.decodeTps)} ${fmt(run.totalTps)} ${fmt(run.completionTokens)} (run ${run.run})`);
    }
    if (prompt.median) {
      lines.push(`${name} ${fmt(prompt.median.ttftMs)} ${fmt(prompt.median.tpotMs)} ${fmt(prompt.median.decodeTps)} ${fmt(prompt.median.totalTps)} ${fmt(prompt.median.completionTokens)} median`);
    }
    if (prompt.p95) {
      lines.push(`${name} ${fmt(prompt.p95.ttftMs)} ${fmt(prompt.p95.tpotMs)} ${fmt(prompt.p95.decodeTps)} ${fmt(prompt.p95.totalTps)} ${fmt(prompt.p95.completionTokens)} p95`);
    }
  }
  lines.push("");
  lines.push(`decode_tps_mean_of_medians: ${fmt(benchmark.aggregate.decodeTpsMeanOfMedians)}`);
  lines.push(`spec_draft_counter: ${benchmark.specDecode.draftCounter ?? "not detected"}`);
  lines.push(`spec_accepted_counter: ${benchmark.specDecode.acceptedCounter ?? "not detected"}`);
  lines.push(`spec_draft_delta: ${fmt(benchmark.specDecode.draftDelta)}`);
  lines.push(`spec_accepted_delta: ${fmt(benchmark.specDecode.acceptedDelta)}`);
  lines.push(`spec_acceptance_rate: ${benchmark.specDecode.acceptanceRate === null ? "n/a" : `${benchmark.specDecode.acceptanceRate}%`}`);
  if (benchmark.errors.length > 0) {
    lines.push("");
    lines.push("errors:");
    for (const error of benchmark.errors) lines.push(`- ${error}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderBundleReadme(args: {
  runDir: string;
  report: ScanReport;
  benchmark: BenchmarkJson;
  dockerEvidence: DockerImageEvidence;
  runConfig: object;
}): string {
  const { benchmark, dockerEvidence, report } = args;
  const hardware = `${report.cpu.model ?? "unknown CPU"}, ${report.gpu.gpus[0]?.name ?? "no accelerator detected"}`;
  const artifacts = [
    "run_config.json",
    "hardware_profile.json",
    "software_versions.json",
    "docker_image.json",
    "command.txt",
    "boot.log",
    "boot_meta.json",
    "nvidia_smi_pre.txt",
    "metrics_start.txt",
    "metrics_end.txt",
    "benchmark_result.txt",
    "benchmark_result.json",
    "summary.json"
  ];
  return `# Latitude AI Profiler vLLM Benchmark Bundle

**Status**: ${benchmark.status}  
**Generated**: ${benchmark.run.timestampUtc}  
**Endpoint**: \`${benchmark.environment.endpoint}\`  
**Model**: \`${benchmark.environment.model ?? "unknown"}\`  
**Hardware**: ${hardware}

## Reproducibility

- **Profiler version**: \`${VERSION}\`
- **Runtime**: \`vllm\`
- **vLLM version**: \`${benchmark.environment.vllmVersion ?? "unknown"}\`
- **Docker container**: \`${dockerEvidence.container ?? "not specified"}\`
- **Docker image ref**: \`${dockerEvidence.imageRef ?? "not captured"}\`
- **Docker image digest**: \`${dockerEvidence.imageDigest ?? "not captured"}\`
- **Command used**: see \`command.txt\`

## Results

- **Mean decode TPS across prompt medians**: ${fmt(benchmark.aggregate.decodeTpsMeanOfMedians)}
- **Lowest prompt median decode TPS**: ${fmt(benchmark.aggregate.decodeTpsMinMedian)}
- **Highest prompt median decode TPS**: ${fmt(benchmark.aggregate.decodeTpsMaxMedian)}
- **Speculative decoding acceptance rate**: ${benchmark.specDecode.acceptanceRate === null ? "not detected" : `${benchmark.specDecode.acceptanceRate}%`}

## Artifacts

${artifacts.map((artifact) => `- \`${artifact}\``).join("\n")}

## Notes

- This bundle uses synthetic benchmark prompts only.
- It does not collect source code, customer prompts, datasets, model weights, environment variables, secrets, or customer files.
- If \`--container\` was provided, \`boot.log\` contains Docker logs. Review logs before sharing externally.
- If Docker image digest is missing, pass \`--container <name-or-id>\` and make sure the image was pulled from a registry with RepoDigest metadata.
${benchmark.errors.length > 0 ? `\n## Errors\n\n${benchmark.errors.map((error) => `- ${error}`).join("\n")}\n` : ""}`;
}

function skippedBenchmark(label: string, endpoint: string, model: string | null, startedAt: Date, runs: number, warmupRuns: number, maxTokens: number): BenchmarkJson {
  return {
    status: "SKIPPED",
    errors: [],
    run: {
      label,
      timestampUtc: startedAt.toISOString(),
      endTimestampUtc: null,
      elapsedSeconds: null,
      runs,
      warmupRuns,
      maxTokens,
      promptsHash: promptsHash()
    },
    environment: { endpoint, model, vllmVersion: null },
    prompts: {},
    aggregate: { decodeTpsMeanOfMedians: null, decodeTpsMinMedian: null, decodeTpsMaxMedian: null },
    specDecode: emptySpecDecode()
  };
}

function emptySpecDecode(): SpecDecodeSummary {
  return {
    draftCounter: null,
    acceptedCounter: null,
    draftStart: null,
    draftEnd: null,
    draftDelta: null,
    acceptedStart: null,
    acceptedEnd: null,
    acceptedDelta: null,
    acceptanceRate: null
  };
}

async function fetchTextOrNote(url: string): Promise<string> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return await response.text();
  } catch (error) {
    return `fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}\n`;
  }
}

async function fetchJsonOrText(url: string): Promise<{ ok: boolean; status: number | null; body: unknown }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    try {
      return { ok: response.ok, status: response.status, body: JSON.parse(text) };
    } catch {
      return { ok: response.ok, status: response.status, body: text };
    }
  } catch (error) {
    return { ok: false, status: null, body: error instanceof Error ? error.message : String(error) };
  }
}

function promptsHash(): string {
  const canonical = Object.entries(PROMPTS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value}`)
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

function normalizeEndpoint(value: string): string {
  return value.replace(/\/+$/, "");
}

function parsePositiveInt(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name}: expected a positive integer.`);
  }
  return parsed;
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sanitizeLabel(value: string): string {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "vllm";
}

function fmt(value: number | null): string {
  return value === null || Number.isNaN(value) ? "n/a" : String(value);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function renderBundleCliSummary(runDir: string, summary: BenchmarkJson): string {
  return [
    "Latitude AI Profiler Benchmark Bundle",
    "",
    `Bundle: ${runDir}`,
    `Status: ${summary.status}`,
    `Endpoint: ${summary.environment.endpoint}`,
    `Model: ${summary.environment.model ?? "unknown"}`,
    `Mean Decode TPS: ${fmt(summary.aggregate.decodeTpsMeanOfMedians)}`,
    `Spec Acceptance Rate: ${summary.specDecode.acceptanceRate === null ? "not detected" : `${summary.specDecode.acceptanceRate}%`}`,
    "",
    `Open ${basename(runDir)}/README.md for the human-readable summary.`
  ].join("\n");
}
