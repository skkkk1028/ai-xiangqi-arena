$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceRoot = Join-Path $projectRoot 'services\stockfish-bridge'
$runtimeRoot = Join-Path $serviceRoot 'runtime'
$archivePath = Join-Path $runtimeRoot 'stockfish18.zip'
$downloadUrl = 'https://github.com/official-stockfish/Stockfish/releases/download/sf_18/stockfish-windows-x86-64-avx2.zip'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Write-Host 'Downloading the pinned official Stockfish 18 AVX2 release...'
Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath
Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeRoot -Force
$binary = Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File | Where-Object { $_.Name -match '^stockfish.*avx2.*\.exe$' } | Select-Object -First 1
if (-not $binary) { throw 'The Stockfish 18 AVX2 executable was not found in the official archive.' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $binary.FullName).Hash.ToLowerInvariant()
$versionOutput = "uci`nquit`n" | & $binary.FullName 2>&1 | Out-String
if ($versionOutput -notmatch 'Stockfish 18') { throw "Downloaded binary did not identify itself as Stockfish 18: $versionOutput" }
$envPath = Join-Path $serviceRoot '.env'
@(
  'PORT=8791'
  "STOCKFISH_BIN_PATH=$($binary.FullName)"
  "STOCKFISH_BIN_SHA256=$hash"
  'STOCKFISH_THREADS=4'
  'STOCKFISH_HASH_MB=128'
  'STOCKFISH_TIMEOUT_MS=45000'
) | Set-Content -LiteralPath $envPath -Encoding utf8
Write-Host "Stockfish 18 installed and verified: $($binary.FullName)"
Write-Host "SHA-256: $hash"
