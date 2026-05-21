import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function runDiskBenchmark(sizeMiB = 64): Promise<{ tempPath: string; writeMBps: number | null; readMBps: number | null }> {
  const dir = await mkdtemp(join(tmpdir(), "latitude-ai-profiler-"));
  const file = join(dir, "disk-bench.tmp");
  const buffer = Buffer.alloc(sizeMiB * 1024 * 1024, 7);
  let writeMBps: number | null = null;
  let readMBps: number | null = null;
  try {
    const writeStart = performance.now();
    await writeFile(file, buffer);
    writeMBps = sizeMiB / ((performance.now() - writeStart) / 1000);
    const readStart = performance.now();
    await readFile(file);
    readMBps = sizeMiB / ((performance.now() - readStart) / 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { tempPath: dir, writeMBps, readMBps };
}
