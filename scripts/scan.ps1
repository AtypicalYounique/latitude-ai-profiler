$ErrorActionPreference = "Stop"

$Repo = if ($env:LATITUDE_AI_PROFILER_REPO) { $env:LATITUDE_AI_PROFILER_REPO } else { "AtypicalYounique/latitude-ai-profiler" }
$Version = if ($env:LATITUDE_AI_PROFILER_VERSION) { $env:LATITUDE_AI_PROFILER_VERSION } else { "latest" }

function Fail($Message) {
  Write-Error "latitude-ai-profiler: $Message"
  exit 1
}

$Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
switch ($Arch) {
  "x64" { $AssetArch = "x64" }
  "arm64" { $AssetArch = "arm64" }
  default { Fail "unsupported CPU architecture '$Arch'. Supported: x64 and arm64." }
}

$Asset = "latitude-ai-profiler-windows-$AssetArch.exe"
if ($Version -eq "latest") {
  $Url = "https://github.com/$Repo/releases/latest/download/$Asset"
} else {
  $Url = "https://github.com/$Repo/releases/download/$Version/$Asset"
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("latitude-ai-profiler-" + [System.Guid]::NewGuid().ToString("N"))
$BinPath = Join-Path $TempDir $Asset

New-Item -ItemType Directory -Path $TempDir | Out-Null
try {
  Write-Error "Downloading latitude-ai-profiler for windows/$AssetArch..."
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $BinPath

  if ($args.Count -gt 0) {
    switch ($args[0]) {
      "scan" { & $BinPath @args; exit $LASTEXITCODE }
      "benchmark" { & $BinPath @args; exit $LASTEXITCODE }
      "bundle" { & $BinPath @args; exit $LASTEXITCODE }
      "version" { & $BinPath @args; exit $LASTEXITCODE }
      "--help" { & $BinPath @args; exit $LASTEXITCODE }
      "-h" { & $BinPath @args; exit $LASTEXITCODE }
      "--version" { & $BinPath @args; exit $LASTEXITCODE }
      "-V" { & $BinPath @args; exit $LASTEXITCODE }
    }
  }

  & $BinPath scan --yes @args
  exit $LASTEXITCODE
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
