$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serviceRoot = Join-Path $projectRoot 'services\chess-arena-bridge'
$runtimeRoot = Join-Path $serviceRoot 'runtime'
$obsidianPath = Join-Path $runtimeRoot 'Obsidian160-avx2.exe'
$obsidianUrl = 'https://github.com/gab8192/Obsidian/releases/download/v16.0/Obsidian160-avx2.exe'
$expectedObsidianHash = '00f9f5566e815275e29fec85f1e4d1dff0b8301ceb23f6bb79de68dcdce98743'
$stockfishEnv = Join-Path $projectRoot 'services\stockfish-bridge\.env'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Write-Host 'Downloading pinned official Obsidian 16.0 AVX2 release...'
Invoke-WebRequest -Uri $obsidianUrl -OutFile $obsidianPath
$obsidianHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $obsidianPath).Hash.ToLowerInvariant()
if ($obsidianHash -ne $expectedObsidianHash) { throw "Obsidian 16.0 official asset checksum mismatch: $obsidianHash" }
$identity = "uci`nquit`n" | & $obsidianPath 2>&1 | Out-String
if ($identity -notmatch 'Obsidian\s*16') { throw "Downloaded binary did not identify itself as Obsidian 16: $identity" }
if (-not (Test-Path -LiteralPath $stockfishEnv)) { throw 'Install Stockfish 18 first with npm run setup:stockfish18.' }
$stockfish = Get-Content -LiteralPath $stockfishEnv | Where-Object { $_ -match '^STOCKFISH_(BIN_PATH|BIN_SHA256)=' }
if ($stockfish.Count -ne 2) { throw 'The Stockfish 18 environment is incomplete.' }
@('PORT=8792', $stockfish, "OBSIDIAN_BIN_PATH=$obsidianPath", "OBSIDIAN_BIN_SHA256=$obsidianHash", 'ARENA_TIMEOUT_MS=45000') | Set-Content -LiteralPath (Join-Path $serviceRoot '.env') -Encoding utf8
Write-Host "Obsidian 16.0 installed and verified: $obsidianPath"
Write-Host "SHA-256: $obsidianHash"
