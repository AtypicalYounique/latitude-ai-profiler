#!/bin/sh
set -eu

target="${1:-}"
asset="${2:-}"
export PKG_CACHE_PATH="${PKG_CACHE_PATH:-$PWD/.pkg-cache}"

if [ -z "$target" ] || [ -z "$asset" ]; then
  os="$(uname -s 2>/dev/null || true)"
  machine="$(uname -m 2>/dev/null || true)"

  case "$os" in
    Darwin) platform="macos"; asset_platform="darwin" ;;
    Linux) platform="linux"; asset_platform="linux" ;;
    *) echo "Unsupported OS for local standalone build: $os" >&2; exit 1 ;;
  esac

  case "$machine" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported architecture for local standalone build: $machine" >&2; exit 1 ;;
  esac

  target="node18-${platform}-${arch}"
  asset="latitude-ai-profiler-${asset_platform}-${arch}"
fi

mkdir -p release
npm run build

pkg_bin="./node_modules/.bin/pkg"
if [ ! -x "$pkg_bin" ]; then
  echo "Missing standalone builder. Run npm install first." >&2
  exit 1
fi

"$pkg_bin" package.json --targets "$target" --output "release/$asset"
chmod +x "release/$asset"
"release/$asset" version
