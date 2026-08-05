@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

if not defined NODE_EXE (
  echo Node.js was not found. Install the current LTS version from https://nodejs.org/ and run this script again.
  pause
  exit /b 1
)

for %%D in ("%NODE_EXE%") do set "NPM_CLI=%%~dpDnode_modules\npm\bin\npm-cli.js"
if not exist "%NPM_CLI%" set "NPM_CLI=%ProgramFiles%\nodejs\node_modules\npm\bin\npm-cli.js"

if not exist "%NPM_CLI%" (
  echo npm was not found beside Node.js. Repair or reinstall the current Node.js LTS version and run this script again.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\typescript\bin\tsc" (
  echo Project dependencies were not found. Run npm install in this folder, then run this script again.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules\vite\bin\vite.js" (
  echo Project dependencies were not found. Run npm install in this folder, then run this script again.
  pause
  exit /b 1
)

echo Building AI Xiangqi for Cloudflare Pages...
call :build
if errorlevel 1 (
  echo Build failed. Keep this window open and check the error above.
  pause
  exit /b 1
)

echo Uploading the production build to Cloudflare Pages...
if exist "%~dp0node_modules\wrangler\bin\wrangler.js" (
  "%NODE_EXE%" "%~dp0node_modules\wrangler\bin\wrangler.js" pages deploy .vite-output --project-name ai-xiangqi-arena-public --branch main
) else (
  "%NODE_EXE%" "%NPM_CLI%" exec --yes --package=wrangler -- wrangler pages deploy .vite-output --project-name ai-xiangqi-arena-public --branch main
)
if errorlevel 1 (
  echo Deployment failed. Confirm network access, Wrangler login, and that the Pages project exists.
  pause
  exit /b 1
)

echo Deployment completed. Wrangler printed the public URL above.
pause
endlocal
exit /b 0

:build
"%NODE_EXE%" "%~dp0scripts\sync-engine-assets.mjs"
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\typescript\bin\tsc" -b
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\vite\bin\vite.js" build
if errorlevel 1 exit /b 1
copy /Y "%~dp0worker\static-site-worker.mjs" "%~dp0.vite-output\_worker.js" >nul
exit /b %errorlevel%
