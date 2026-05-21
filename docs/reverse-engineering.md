# Reverse Engineering Notes: Andyyyy64/whichllm

Source reviewed: `https://github.com/Andyyyy64/whichllm`

## What whichllm Does

`whichllm` is a Python/Typer CLI that detects local hardware, fetches model and benchmark metadata, estimates model fit, and ranks local LLM choices. Its README describes the core loop as hardware auto-detection plus ranking Hugging Face models that fit the machine.

## Architecture Observed

- `whichllm/cli.py`: Typer command surface. Default command detects hardware, fetches/caches models, fetches/caches benchmark scores, groups model families, ranks results, and displays table or JSON.
- `whichllm/hardware/*`: fail-safe hardware detectors split by vendor and platform. The orchestrator calls NVIDIA, AMD, Intel, Apple, Windows, CPU, RAM, and disk detectors and returns one `HardwareInfo`.
- `whichllm/engine/*`: compatibility, VRAM estimation, quantization, speed estimation, and rank scoring.
- `whichllm/models/*`: Hugging Face model fetch/cache, model grouping, benchmark source aggregation, and evidence handling.
- `whichllm/output/display.py`: human-readable tables, status fields, confidence labels, and JSON output.

## Detection And Fit Patterns Worth Reusing

- Each detector fails safe and returns partial data instead of crashing.
- Hardware data is normalized into a small typed object before recommendation logic runs.
- Fit is explicit: `full_gpu`, `partial_offload`, or `cpu_only`.
- Memory planning reserves headroom. `whichllm` uses an 80% usable-RAM assumption for CPU/offload reasoning.
- Compatibility reports warnings separately from the core fit decision.
- Estimates expose confidence and notes rather than presenting precise predictions as fact.
- Display separates compact user-facing output from machine-readable JSON.

## What We Did Not Copy

- We did not copy the Hugging Face model fetcher, benchmark aggregation, leaderboard scoring, one-command model download, chat runner, or exact token/sec estimator.
- Those are consumer/local-LLM features and would violate this V1 profiler's scope if they encouraged model downloads or exact performance claims.

## Adaptation For latitude-ai-profiler

The Latitude profiler now keeps the same high-level shape but targets data-center sales engineering:

- collectors normalize infrastructure metadata
- rules infer bottlenecks, workload fit, and Latitude hardware class
- reports expose confidence, assumptions, privacy boundaries, and validation questions
- optional benchmarks remain lightweight and explicit

The new `src/rules/modelFit.ts` is the main adaptation from the whichllm architecture: it adds broad fit-type estimates for embeddings, 7B/13B/30B/70B quantized inference, large-context serving, and fine-tuning without fetching models or claiming exact token throughput.
