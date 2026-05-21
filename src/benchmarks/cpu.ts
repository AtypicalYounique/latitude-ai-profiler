import { gzipSync } from "node:zlib";

export async function runCpuBenchmark(): Promise<{ operation: string; score: number | null; elapsedMs: number | null }> {
  const input = Buffer.alloc(16 * 1024 * 1024, "latitude-ai-profiler");
  const start = performance.now();
  let bytes = 0;
  for (let i = 0; i < 8; i += 1) {
    bytes += gzipSync(input).byteLength;
  }
  const elapsedMs = performance.now() - start;
  return {
    operation: "gzip 8 x 16MiB buffer",
    score: bytes > 0 ? 128 / (elapsedMs / 1000) : null,
    elapsedMs
  };
}
