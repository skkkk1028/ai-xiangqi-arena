$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bookRoot = Join-Path $projectRoot 'benchmark-assets\chess'
$archive = Join-Path $bookRoot 'UHO_Lichess_4852_v1.epd.zip'
$url = 'https://raw.githubusercontent.com/official-stockfish/books/master/UHO_Lichess_4852_v1.epd.zip'
New-Item -ItemType Directory -Force -Path $bookRoot | Out-Null
Invoke-WebRequest -Uri $url -OutFile $archive
Expand-Archive -LiteralPath $archive -DestinationPath $bookRoot -Force
$book = Get-ChildItem -LiteralPath $bookRoot -Recurse -Filter 'UHO_Lichess_4852_v1.epd' | Select-Object -First 1
if (-not $book) { throw 'Official UHO book extraction failed.' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $book.FullName).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $bookRoot 'UHO_Lichess_4852_v1.epd.sha256') -Value "$hash  UHO_Lichess_4852_v1.epd" -Encoding ascii
Write-Host "Official UHO book ready: $($book.FullName)"
Write-Host "SHA-256: $hash"
