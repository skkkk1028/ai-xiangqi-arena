@echo off
setlocal
cd /d "%~dp0"

set "PORT=4173"
set "NODE_EXE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

if not defined NODE_EXE (
  echo Node.js was not found. Install the current LTS version from https://nodejs.org/ and run this script again.
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

echo Building the latest AI Xiangqi preview...
call :build
if errorlevel 1 (
  echo Build failed. Keep this window open and check the error above.
  pause
  exit /b 1
)

set "LISTEN_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do set "LISTEN_PID=%%P"
if defined LISTEN_PID (
  echo Port %PORT% is already used by PID %LISTEN_PID%.
  echo Stop the previous local preview before starting this freshly built version.
  pause
  exit /b 1
)

start "AI Xiangqi preview" /b "%NODE_EXE%" "%~dp0node_modules\vite\bin\vite.js" preview --outDir .vite-output --host 127.0.0.1 --port %PORT% --strictPort
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"

echo AI Xiangqi is available at http://127.0.0.1:%PORT%/
echo Closing this window will not stop the preview. Restarting Windows will stop it.
endlocal
exit /b 0

:build
"%NODE_EXE%" "%~dp0scripts\sync-engine-assets.mjs"
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\typescript\bin\tsc" -b
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\vite\bin\vite.js" build
exit /b %errorlevel%
