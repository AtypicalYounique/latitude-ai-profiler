#!/bin/sh
set -eu

REPO="${LATITUDE_AI_PROFILER_REPO:-AtypicalYounique/latitude-ai-profiler}"
VERSION="${LATITUDE_AI_PROFILER_VERSION:-latest}"

say() {
  printf '%s\n' "$*" >&2
}

fail() {
  say "latitude-ai-profiler: $*"
  exit 1
}

os="$(uname -s 2>/dev/null || true)"
machine="$(uname -m 2>/dev/null || true)"

case "$os" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) fail "unsupported operating system '$os'. Supported: macOS and Linux." ;;
esac

case "$machine" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) fail "unsupported CPU architecture '$machine'. Supported: x64 and arm64." ;;
esac

asset="latitude-ai-profiler-${platform}-${arch}"

if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
fi

tmp_dir="${TMPDIR:-/tmp}/latitude-ai-profiler.$$"
bin_path="${tmp_dir}/${asset}"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT INT TERM
mkdir -p "$tmp_dir"

say "Downloading latitude-ai-profiler for ${platform}/${arch}..."

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$bin_path"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$url" -O "$bin_path"
else
  fail "curl or wget is required to download the standalone profiler."
fi

chmod +x "$bin_path"

if [ "$#" -gt 0 ]; then
  case "$1" in
    scan|benchmark|version|--help|-h|--version|-V)
      "$bin_path" "$@"
      exit $?
      ;;
  esac
fi

"$bin_path" scan --yes "$@"
