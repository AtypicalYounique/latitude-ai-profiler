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

## No-Node Quick Run

For people who do not have Node or npm installed, use the standalone runner:

```bash
curl -fsSL https://raw.githubusercontent.com/AtypicalYounique/latitude-ai-profiler/main/scripts/scan.sh | sh
```

This downloads the right standalone binary for macOS or Linux, runs a safe scan, prints the short summary, and deletes the temporary binary afterward.

With workload intent:

```bash
curl -fsSL https://raw.githubusercontent.com/AtypicalYounique/latitude-ai-profiler/main/scripts/scan.sh | sh -s -- --workload inference --model-size 70b --concurrency high
```

Create a reproducible vLLM benchmark bundle without installing Node:

```bash
curl -fsSL https://raw.githubusercontent.com/AtypicalYounique/latitude-ai-profiler/main/scripts/scan.sh | sh -s -- bundle vllm --yes --endpoint http://localhost:8000 --model your-served-model --label customer-validation
```

Once `latitude-ai-profiler.com/scan` is pointed at the same script, the branded command is:

```bash
curl -fsSL https://latitude-ai-profiler.com/scan | sh
```

## Install With npm

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

Create a reproducible benchmark evidence bundle around an existing vLLM server:

```bash
latitude-ai-profiler bundle vllm --yes --endpoint http://localhost:8000 --model your-served-model --container vllm-8000 --label h100-validation
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

### `bundle vllm`

Creates a reproducible benchmark bundle for an existing OpenAI-compatible vLLM endpoint. The command is intended for sales engineering and customer validation, where a one-line terminal summary is not enough evidence.

The profiler writes a timestamped folder under `benchmark-runs/` by default. Each run includes:

- `run_config.json`: run options and privacy note
- `hardware_profile.json`: detected system, CPU, memory, GPU, storage, network, and recommendation context
- `software_versions.json`: OS, Docker, Kubernetes, Python, AI runtime, and collector warnings
- `docker_image.json`: container/image evidence and registry digest when `--container` is provided
- `command.txt`: the runtime command you provide with `--command`
- `boot.log`: Docker logs when `--container` is provided; review before sharing externally
- `boot_meta.json`: health, version, model, and container metadata
- `nvidia_smi_pre.txt`: pre-run `nvidia-smi` output when available
- `metrics_start.txt` and `metrics_end.txt`: raw vLLM `/metrics` scrapes
- `benchmark_result.txt`: human-readable benchmark output
- `benchmark_result.json`: parsed benchmark result with per-prompt medians and p95s
- `summary.json`: compact machine-readable summary
- `README.md`: per-run human summary

Example with workload evidence:

```bash
latitude-ai-profiler bundle vllm --yes \
  --endpoint http://localhost:8000 \
  --model qwen3.6-27b \
  --container vllm-8000 \
  --command "docker run ... vllm/vllm-openai@sha256:..." \
  --label qwen-validation \
  --runs 5 \
  --max-tokens 500
```

Useful options:

- `--endpoint <url>`: vLLM endpoint, default `http://localhost:8000`
- `--model <name>`: served model name; if omitted, the profiler tries `/v1/models`
- `--container <name-or-id>`: Docker container to inspect for boot logs and image digest
- `--command <command>`: records the exact runtime command in `command.txt`
- `--runs <n>`: runs per synthetic prompt, default `3`
- `--warmup-runs <n>`: warmups per synthetic prompt, default `1`
- `--max-tokens <n>`: max generated tokens per request, default `128`
- `--skip-benchmark`: capture provenance and metrics without sending completions
- `--anonymize`: redact hostname, local IPs, and container-name surfaces in infrastructure profile outputs

The vLLM bundle scrapes `/metrics` before and after the benchmark. If speculative decoding counters are present, it computes acceptance rate from the change in draft-token and accepted-token counters. Bundle mode uses synthetic prompts, but `boot.log` is real Docker log output when `--container` is provided.

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

Standalone release binaries are built by `.github/workflows/standalone-release.yml` when a `v*` tag is pushed. The `scripts/scan.sh` bootstrapper downloads the latest release binary for the current platform.

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
- More runtime benchmark bundles beyond vLLM
- Cluster/Kubernetes benchmark bundle mode
- Megaport/private connectivity recommendations
- Dashboard upload
