# latitude-ai-profiler

`latitude-ai-profiler` is a TypeScript/Node.js CLI that safely profiles an AI server or bare metal node and produces a Latitude-style infrastructure recommendation report.

It is designed for both local development machines and data-center AI infrastructure: detect what the node has, infer likely workload fit and bottlenecks, and recommend a broad Latitude hardware class without making exact performance claims.

The architecture was informed by [`Andyyyy64/whichllm`](https://github.com/Andyyyy64/whichllm): fail-safe hardware detection, normalized hardware objects, explicit fit types, visible assumptions, and confidence-aware output. This project does not copy whichllm's consumer model-ranking, Hugging Face fetching, chat runner, model downloads, or exact token/sec planning.

## What It Collects

- CPU model, cores, threads, and frequency metadata
- RAM and swap capacity metadata
- NVIDIA GPU model, count, VRAM, utilization, power, driver, and CUDA compatibility from `nvidia-smi`
- Apple Silicon local accelerators and unified/shared memory on macOS
- Mounted disk capacity metadata from `df` and `lsblk`
- Network interface basics
- OS, kernel, architecture, and hostname unless anonymized
- Docker installation, daemon state, running container image/status/port metadata
- Kubernetes context name and node summary when `kubectl` access works
- Python version and selected AI package versions through package metadata
- Selected binary versions such as Docker, kubectl, nvidia-smi, nvcc, Ollama, llama-server, and vLLM
- Optional user-provided workload intent such as workload type, model size, concurrency, context length, and quantization

## What It Does Not Collect

The profiler does not collect source code, prompts, datasets, model weights, environment variables, secrets, API keys, SSH keys, customer files, private application data, container environment variables, Kubernetes secrets/configmaps, or application logs.

The tool is metadata-only by design.

## Install

```bash
npm install -g latitude-ai-profiler
```

For local development:

```bash
npm install
npm run build
node dist/cli.js scan --yes
```

## Usage

Run a scan and print a short terminal summary:

```bash
npx latitude-ai-profiler scan --yes
```

Run a scan with workload intent:

```bash
npx latitude-ai-profiler scan --yes --workload inference --model-size 70b --concurrency high
```

Write JSON and Markdown reports:

```bash
latitude-ai-profiler scan --yes --json report.json --md report.md
```

Print the full Markdown report to the terminal:

```bash
latitude-ai-profiler scan --yes --full
```

Anonymize host, local IP, and container-name surfaces:

```bash
latitude-ai-profiler scan --yes --anonymize --json report.json --md report.md
```

Run explicit lightweight benchmarks:

```bash
latitude-ai-profiler benchmark --yes --json benchmark.json
```

Include benchmarks in a scan:

```bash
latitude-ai-profiler scan --yes --with-benchmarks --md report.md
```

## Commands

### `scan`

Collects safe, read-only infrastructure diagnostics and generates a report. It is platform-aware: macOS gets local Apple Silicon/shared-memory detection, while Linux AI servers get deeper NVIDIA, disk, Docker, and Kubernetes diagnostics. Every collector fails gracefully with a warning if a command is unavailable or permission is denied.

Options:

- `--yes`: required confirmation
- `--json <path>`: write JSON report
- `--md <path>`: write Markdown report
- `--full`: print the full Markdown report to stdout instead of the short summary
- `--anonymize`: redact hostname, local IPs, and container names
- `--with-benchmarks`: include optional lightweight approximate benchmarks
- `--workload <kind>`: target workload, such as `inference`, `embeddings`, `rag`, `fine-tuning`, `training`, `image`, `video`, `vector-db`, `orchestration`, `rpc`, `game-server`, or `preprocessing`
- `--model-size <size>`: planned model size, such as `7b`, `13b`, `70b`, or `405b`
- `--concurrency <level>`: expected concurrency, such as `low`, `medium`, `high`, or a rough request count
- `--context-tokens <tokens>`: planned context window token count
- `--quantization <type>`: planned precision or quantization, such as `q4`, `q5`, `q8`, `fp16`, or `bf16`

Workload intent is optional planning metadata. It does not inspect prompts, datasets, model files, or application code.

### `benchmark`

Runs explicit approximate benchmarks:

- Sequential disk write/read using a temporary file
- Small CPU compression benchmark
- Network latency to public resolver IPs
- GPU smoke test only through PyTorch CUDA if available

Constraints:

- No model downloads
- No stress tests
- No mining-like workload
- No long GPU burn
- Temporary files are deleted

### `version`

Prints the CLI version.

## Publishing

This package is set up for npm distribution. The package publishes only `dist` and `README.md`, builds automatically before packing, and exposes the `latitude-ai-profiler` binary.

Dry-run the package contents:

```bash
npm run pack:dry-run
```

Publish when logged into the right npm account:

```bash
npm publish --access public
```

After publishing, users can run:

```bash
npx latitude-ai-profiler scan --yes
```

## Recommendation Logic

The V1 recommendation engine is heuristic and cautious. It maps detected metadata to broad Latitude-style infrastructure classes:

- AMD EPYC CPU bare metal
- RTX 6000 Ada class
- L40S class
- H100 80GB class
- H200 141GB class
- Multi-node GPU cluster

Example rules:

- No GPU: recommend CPU bare metal for CPU workloads and flag GPU inference limitations.
- GPU VRAM under 24 GB: fit for small quantized models, embeddings, and dev/test.
- GPU VRAM from 24 GB to 48 GB: recommend RTX 6000 Ada or L40S class.
- GPU VRAM around 80 GB: recommend H100 class.
- GPU VRAM above 120 GB: recommend H200 class.
- Multiple high-memory GPUs: recommend multi-GPU or multi-node planning.
- Missing vLLM, TensorRT-LLM, or SGLang: flag a possible software optimization opportunity.
- Workload intent can raise or lower the recommended class. For example, `--workload inference --model-size 70b --concurrency high` will bias recommendations toward H100/H200 or multi-GPU classes, while `--workload embeddings` can fit smaller accelerator or CPU-heavy profiles.

The report avoids exact tokens/sec, cost-per-token, or performance guarantees. Those require workload-specific benchmarking.

## Editing Latitude Hardware Profiles

Hardware classes live in:

```text
src/rules/latitudeProfiles.ts
```

Recommendation mapping lives in:

```text
src/rules/recommendations.ts
```

Update those files to add real SKU names, pricing, regions, availability, or more precise sales guidance.

## Limitations

- NVIDIA GPU detection uses `nvidia-smi` only.
- macOS Apple Silicon detection treats unified memory as shared accelerator memory, not dedicated data-center VRAM.
- Package detection relies on the active Python executable and `pip show`.
- Kubernetes detection is intentionally shallow and avoids secrets, configmaps, pod env, and logs.
- Docker detection does not inspect container internals.
- Benchmark results are approximate and lightweight.
- Recommendations are heuristic and should be validated with real workloads.

## Roadmap

- Real Latitude SKU database
- Pricing model
- Cost per 1M tokens
- Tokens/sec benchmarking
- vLLM live workload detection
- Cluster/Kubernetes mode
- Megaport/private connectivity recommendations
- Dashboard upload
