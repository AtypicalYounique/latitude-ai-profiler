#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { benchmark, scan } from "./index.js";
import { renderJson } from "./report/json.js";
import { renderMarkdown } from "./report/markdown.js";
import { renderSummary } from "./report/summary.js";
import { parseWorkloadIntent } from "./rules/workloadIntent.js";
import { info } from "./utils/logger.js";
import { VERSION } from "./version.js";

const program = new Command();

program
  .name("latitude-ai-profiler")
  .description("Safe AI infrastructure profiler for Latitude-style bare metal recommendations.")
  .version(VERSION);

program
  .command("scan")
  .description("Collect safe, read-only AI infrastructure diagnostics.")
  .option("--yes", "confirm scan without interactive prompt")
  .option("--json <path>", "write JSON report to a file")
  .option("--md <path>", "write Markdown report to a file")
  .option("--full", "print the full Markdown report to stdout instead of the short summary")
  .option("--anonymize", "remove hostname, local IPs, and container names from outputs")
  .option("--with-benchmarks", "include lightweight approximate benchmarks")
  .option("--workload <kind>", "target workload: inference, embeddings, rag, fine-tuning, training, image, video, vector-db, orchestration, rpc, game-server, preprocessing")
  .option("--model-size <size>", "planned model size, such as 7b, 13b, 70b, or 405b")
  .option("--concurrency <level>", "expected concurrency: low, medium, high, or a rough request count")
  .option("--context-tokens <tokens>", "planned context window token count")
  .option("--quantization <type>", "planned precision or quantization, such as q4, q5, q8, fp16, or bf16")
  .action(async (options: {
    yes?: boolean;
    json?: string;
    md?: string;
    full?: boolean;
    anonymize?: boolean;
    withBenchmarks?: boolean;
    workload?: string;
    modelSize?: string;
    concurrency?: string;
    contextTokens?: string;
    quantization?: string;
  }) => {
    requireYes(options.yes, "scan");
    const workloadIntent = parseWorkloadIntent(options);
    const report = await scan({
      anonymize: Boolean(options.anonymize),
      includeBenchmarks: Boolean(options.withBenchmarks),
      workloadIntent
    });
    await emitReports(report, options.json, options.md, Boolean(options.full));
  });

program
  .command("benchmark")
  .description("Run explicit lightweight approximate benchmarks.")
  .option("--yes", "confirm benchmark without interactive prompt")
  .option("--json <path>", "write JSON benchmark results to a file")
  .action(async (options: { yes?: boolean; json?: string }) => {
    requireYes(options.yes, "benchmark");
    const results = await benchmark();
    const json = `${JSON.stringify(results, null, 2)}\n`;
    if (options.json) {
      await writeFile(options.json, json, "utf8");
      info(`Wrote benchmark JSON to ${options.json}`);
    } else {
      process.stdout.write(json);
    }
  });

program
  .command("version")
  .description("Print version.")
  .action(() => {
    process.stdout.write(`${VERSION}\n`);
  });

await program.parseAsync(process.argv);

function requireYes(yes: boolean | undefined, command: string): void {
  if (yes) return;
  throw new Error(`Refusing to run ${command} without --yes. This tool collects infrastructure metadata only; pass --yes to confirm.`);
}

async function emitReports(report: Awaited<ReturnType<typeof scan>>, jsonPath?: string, mdPath?: string, full = false): Promise<void> {
  const json = renderJson(report);
  const markdown = renderMarkdown(report);
  if (jsonPath) {
    await writeFile(jsonPath, json, "utf8");
    info(`Wrote JSON report to ${jsonPath}`);
  }
  if (mdPath) {
    await writeFile(mdPath, markdown, "utf8");
    info(`Wrote Markdown report to ${mdPath}`);
  }
  if (!jsonPath && !mdPath && full) {
    process.stdout.write(markdown);
  } else if (!jsonPath && !mdPath) {
    process.stdout.write(renderSummary(report));
  }
}
