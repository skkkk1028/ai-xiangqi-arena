@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "BUILD_ONLY=0"
set "NO_PAUSE=0"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--build-only" set "BUILD_ONLY=1"& shift& goto parse_args
if /i "%~1"=="--no-pause" set "NO_PAUSE=1"& shift& goto parse_args
echo Unknown option: %~1
goto :fail

:args_done
set "NODE_EXE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

if not defined NODE_EXE (
  echo Node.js was not found. Install the current LTS version and run this script again.
  goto :fail
)

for %%D in ("%NODE_EXE%") do set "NPM_CLI=%%~dpDnode_modules\npm\bin\npm-cli.js"
if not exist "%NPM_CLI%" set "NPM_CLI=%ProgramFiles%\nodejs\node_modules\npm\bin\npm-cli.js"
if not exist "%NPM_CLI%" (
  echo npm was not found beside Node.js. Repair the existing Node.js installation.
  goto :fail
)

if not exist "%~dp0node_modules\typescript\bin\tsc" (
  echo Project dependencies are missing. This script will not install them automatically.
  goto :fail
)
if not exist "%~dp0node_modules\vite\bin\vite.js" (
  echo Vite is missing. This script will not install project dependencies automatically.
  goto :fail
)

echo Building the latest browser-KataGo site for Cloudflare Pages...
call :build
if errorlevel 1 goto :fail

if "%BUILD_ONLY%"=="1" (
  echo Cloudflare production build completed and passed static verification.
  goto :success
)

echo Uploading the verified build to Cloudflare Pages project ai-xiangqi-arena-public...
if exist "%~dp0node_modules\wrangler\bin\wrangler.js" (
  "%NODE_EXE%" "%~dp0node_modules\wrangler\bin\wrangler.js" pages deploy .vite-output --project-name ai-xiangqi-arena-public --branch main
) else (
  "%NODE_EXE%" "%NPM_CLI%" exec --yes --package=wrangler -- wrangler pages deploy .vite-output --project-name ai-xiangqi-arena-public --branch main
)
if errorlevel 1 (
  echo Deployment failed. Confirm network access, Wrangler login, and the Pages project name.
  goto :fail
)

echo Deployment completed. Wrangler printed the production URL above.
goto :success

:build
set "VITE_KATAGO_BRIDGE=0"
"%NODE_EXE%" "%~dp0scripts\sync-engine-assets.mjs"
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\typescript\bin\tsc" -b
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\vite\bin\vite.js" build
if errorlevel 1 exit /b 1
copy /Y "%~dp0worker\static-site-worker.mjs" "%~dp0.vite-output\_worker.js" >nul
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0scripts\verify-cloudflare-build.mjs"
exit /b %errorlevel%

:success
if "%NO_PAUSE%"=="0" pause
endlocal
exit /b 0

:fail
echo Operation failed. Review the messages above; no older build was deployed by this run.
if "%NO_PAUSE%"=="0" pause
endlocal
exit /b 1
