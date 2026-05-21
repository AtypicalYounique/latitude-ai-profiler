export function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function parseKeyValueLines(text: string, separator = ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(separator);
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + separator.length).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function mibToBytes(mib: number | null): number | null {
  return mib === null ? null : Math.round(mib * 1024 * 1024);
}

export function bytesToGiB(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "unknown";
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export function redactLocalIps(value: string): string {
  return value
    .replace(/\b10\.(\d{1,3}\.){2}\d{1,3}\b/g, "[local-ip]")
    .replace(/\b192\.168\.\d{1,3}\.\d{1,3}\b/g, "[local-ip]")
    .replace(/\b172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}\b/g, "[local-ip]")
    .replace(/\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, "[local-ip]")
    .replace(/\[::1\]|\b::1\b/g, "[local-ip]")
    .replace(/\blocalhost\b/gi, "[local-host]");
}

export function anonymizeText(value: string): string {
  return redactLocalIps(value)
    .replace(/\/Users\/[^/\s"']+/g, "/Users/[user]")
    .replace(/\/home\/[^/\s"']+/g, "/home/[user]");
}
