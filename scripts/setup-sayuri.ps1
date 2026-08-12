$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceRoot = Join-Path $projectRoot 'services\sayuri-bridge'
$runtimeRoot = Join-Path $serviceRoot 'runtime'
$archivePath = Join-Path $runtimeRoot 'sayuri-v0.10.0-cuda12-windows-x64.zip'
$engineRoot = Join-Path $runtimeRoot 'engine'
$archiveHash = '8b240082a2597b19143123d0777f70091a6eb4f14216058f690f1bb65624497f'
$binaryHash = 'ced6fd485400977de36f3da8974f5d7317097040a0fb1062849b80a8afb90c13'
$primaryName = 'sayuri-b12xc384nbt-s4736000-c5540000-w514455-swa.bin.txt'
$primaryHash = '864c7e51cf76ebe62f4c3f638ac829bd510acef47b69f08c15b5233fd0d0a973'
$referenceName = 'sayuri-b12xc384nbt-s4056000-c5115000-w484698-swa.bin.txt'
$referenceHash = '3d6e592b08662e4e90fdfbab3dd3fd3ac0b2c91aa9cfc42163057b9a825fe206'

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null

function Assert-FileHash([string]$Path, [string]$Expected) {
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($actual -ne $Expected) {
    throw "SHA-256 mismatch: $Path`nExpected: $Expected`nActual:   $actual"
  }
  return $true
}

function Get-VerifiedFile([string]$Url, [string]$Path, [string]$Hash, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Host "Downloading $Label from its official release location..."
    try {
      Start-BitsTransfer -Source $Url -Destination $Path
    } catch {
      if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
      Write-Host 'BITS is unavailable; falling back to the Windows curl client.'
      & curl.exe --location --fail --retry 3 --output $Path $Url
      if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
    }
  }
  Assert-FileHash $Path $Hash | Out-Null
}

Get-VerifiedFile `
  'https://github.com/CGLemon/Sayuri/releases/download/v0.10.0/sayuri-v0.10.0-cuda12-windows-x64.zip' `
  $archivePath $archiveHash 'Sayuri v0.10.0 CUDA 12 Windows build'

$primaryPath = Join-Path $runtimeRoot $primaryName
$referencePath = Join-Path $runtimeRoot $referenceName
Get-VerifiedFile "https://download.cglemon.com/v6/weights/$primaryName" $primaryPath $primaryHash 'Sayuri CGF2026 model'
Get-VerifiedFile "https://download.cglemon.com/v6/weights/$referenceName" $referencePath $referenceHash 'Sayuri rated reference model'

$binary = Get-ChildItem -LiteralPath $engineRoot -Recurse -Filter 'sayuri-v0.10.0-cuda12-windows-x64.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $binary) {
  if (Test-Path -LiteralPath $engineRoot) { Remove-Item -LiteralPath $engineRoot -Recurse -Force }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $engineRoot -Force
  $binary = Get-ChildItem -LiteralPath $engineRoot -Recurse -Filter 'sayuri-v0.10.0-cuda12-windows-x64.exe' | Select-Object -First 1
}
if (-not $binary) { throw 'Sayuri executable was not found in the verified official archive.' }
Assert-FileHash $binary.FullName $binaryHash | Out-Null

$lines = @(
  'PORT=8790'
  "SAYURI_BIN_PATH=$($binary.FullName)"
  "SAYURI_BIN_SHA256=$binaryHash"
  "SAYURI_MODEL_PATH=$primaryPath"
  "SAYURI_MODEL_SHA256=$primaryHash"
  'SAYURI_PLAYOUTS=250'
  'SAYURI_TIMEOUT_MS=180000'
  'SAYURI_THREADS=16'
  'SAYURI_BATCH_SIZE=8'
)
[System.IO.File]::WriteAllLines(
  (Join-Path $serviceRoot '.env'),
  $lines,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "Sayuri runtime verified: $($binary.FullName)"
Write-Host "Primary model:   $primaryName"
Write-Host "Reference model: $referenceName"
Write-Host 'The primary model is selected provisionally; run the paired model-screening calibration before claiming it is stronger.'
