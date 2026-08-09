$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceRoot = Join-Path $projectRoot 'services\leela-zero-bridge'
$runtimeRoot = Join-Path $serviceRoot 'runtime'
$archivePath = Join-Path $runtimeRoot 'leela-zero-0.17-win64.zip'
$engineRoot = Join-Path $runtimeRoot 'engine'
$modelName = '0e9ea880fd3c4444695e8ff4b8a36310d2c03f7c858cadd37af3b76df1d1d15f.gz'
$modelPath = Join-Path $runtimeRoot $modelName
$archiveHash = '4c47471be2f2a16cba65766943e87d4cca9d41e09a05a2108b34d42cecaaab3d'
$binaryHashExpected = '61b64cda9ef4678ed614f208a6bb55dcbda5fae56dfe5a6b5afbf9f6a4649a55'
$modelHash = '6937f00970b368c3a7f686f7152d3c0fc491a1ad580258c257de4d2bc58ac00d'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Assert-FileHash([string]$Path, [string]$Expected) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) {
    throw "SHA-256 mismatch: $Path`nExpected: $Expected`nActual:   $actual"
  }
  return $true
}

if (-not (Test-Path -LiteralPath $archivePath)) {
  Write-Host 'Downloading official Leela Zero 0.17 Windows build...'
  Start-BitsTransfer -Source 'https://github.com/leela-zero/leela-zero/releases/download/v0.17/leela-zero-0.17-win64.zip' -Destination $archivePath
}
Assert-FileHash $archivePath $archiveHash | Out-Null

if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host 'Downloading the final official Leela Zero 40x256 network...'
  Start-BitsTransfer -Source "https://zero.sjeng.org/networks/$modelName" -Destination $modelPath
}
Assert-FileHash $modelPath $modelHash | Out-Null

$binary = Get-ChildItem -LiteralPath $engineRoot -Recurse -Filter 'leelaz.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $binary) {
  if (Test-Path -LiteralPath $engineRoot) { Remove-Item -LiteralPath $engineRoot -Recurse -Force }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $engineRoot -Force
  $binary = Get-ChildItem -LiteralPath $engineRoot -Recurse -Filter 'leelaz.exe' | Select-Object -First 1
}
if (-not $binary) { throw 'leelaz.exe was not found in the verified official archive.' }
Assert-FileHash $binary.FullName $binaryHashExpected | Out-Null
$binaryHash = $binaryHashExpected

$lines = @(
  'PORT=8789'
  "LEELA_ZERO_BIN_PATH=$($binary.FullName)"
  "LEELA_ZERO_BIN_SHA256=$binaryHash"
  "LEELA_ZERO_MODEL_PATH=$modelPath"
  "LEELA_ZERO_MODEL_SHA256=$modelHash"
  'LEELA_ZERO_PLAYOUTS=3200'
  'LEELA_ZERO_TIMEOUT_MS=180000'
  'LEELA_ZERO_THREADS=8'
)
[System.IO.File]::WriteAllLines(
  (Join-Path $serviceRoot '.env'),
  $lines,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "Leela Zero runtime verified: $($binary.FullName)"
Write-Host "Binary SHA-256: $binaryHash"
Write-Host "Model SHA-256:  $modelHash"
