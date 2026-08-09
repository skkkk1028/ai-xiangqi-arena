@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT_DIR=%~dp0"
if "%ROOT_DIR:~-1%"=="\" set "ROOT_DIR=%ROOT_DIR:~0,-1%"

set "PREVIEW_PORT=4173"
set "BRIDGE_PORT=8788"
set "LEELA_BRIDGE_PORT=8789"
set "SAYURI_BRIDGE_PORT=8790"
set "VERIFY_ONLY=0"
set "NO_PAUSE=0"
set "BRIDGE_STARTED=0"
set "PREVIEW_STARTED=0"
set "LEELA_BRIDGE_STARTED=0"
set "SAYURI_BRIDGE_STARTED=0"
set "BRIDGE_PID="
set "PREVIEW_PID="
set "LEELA_BRIDGE_PID="
set "SAYURI_BRIDGE_PID="

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--verify" set "VERIFY_ONLY=1"& set "NO_PAUSE=1"& shift& goto parse_args
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
if not exist "%~dp0node_modules\typescript\bin\tsc" (
  echo Project dependencies are missing. This script will not install them automatically.
  goto :fail
)
if not exist "%~dp0node_modules\vite\bin\vite.js" (
  echo Vite is missing. This script will not install project dependencies automatically.
  goto :fail
)
if not exist "%~dp0services\katago-bridge\.env" (
  echo Native KataGo environment file is missing: services\katago-bridge\.env
  goto :fail
)
if not exist "%~dp0services\katago-bridge\runtime\katago.exe" (
  echo Native KataGo executable is missing.
  goto :fail
)
if not exist "%~dp0services\katago-bridge\config\analysis.cfg" (
  echo Native KataGo analysis configuration is missing.
  goto :fail
)
if not exist "%~dp0services\leela-zero-bridge\.env" (
  echo Leela Zero runtime is not configured. Running the verified one-time setup...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-leela-zero.ps1"
  if errorlevel 1 goto :fail
)

set "LISTEN_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PREVIEW_PORT% .*LISTENING"') do set "LISTEN_PID=%%P"
if defined LISTEN_PID (
  echo Port %PREVIEW_PORT% is already used by PID %LISTEN_PID%. Stop the previous preview first.
  goto :fail
)

echo Building the latest Native-KataGo local preview...
call :build
if errorlevel 1 goto :fail

"%NODE_EXE%" "%~dp0scripts\verify-native-katago.mjs" --capabilities-only >nul 2>nul
if not errorlevel 1 (
  echo A verified Native KataGo bridge is already running on port %BRIDGE_PORT%.
  goto :bridge_ready
)

set "BRIDGE_LISTEN_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%BRIDGE_PORT% .*LISTENING"') do set "BRIDGE_LISTEN_PID=%%P"
if defined BRIDGE_LISTEN_PID (
  echo Port %BRIDGE_PORT% is occupied by PID %BRIDGE_LISTEN_PID%, but it is not the configured Native KataGo bridge.
  goto :fail
)

echo Starting Native KataGo bridge in a hidden background process...
for /f "delims=" %%P in ('call "%NODE_EXE%" "%~dp0scripts\start-detached-process.mjs" --cwd "%ROOT_DIR%" --stdout "%TEMP%\project10-katago-bridge.out.log" --stderr "%TEMP%\project10-katago-bridge.err.log" "%NODE_EXE%" "--env-file=%~dp0services\katago-bridge\.env" "%~dp0services\katago-bridge\src\server.mjs"') do set "BRIDGE_PID=%%P"
if not defined BRIDGE_PID (
  echo Failed to start the Native KataGo bridge.
  goto :fail
)
set "BRIDGE_STARTED=1"

echo Waiting for KataGo model and OpenCL initialization...
set "READY_WAIT=0"
:wait_bridge
set /a READY_WAIT+=1
if %READY_WAIT% GTR 300 (
  echo Native KataGo did not become ready. See %TEMP%\project10-katago-bridge.err.log
  goto :fail
)
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
"%NODE_EXE%" "%~dp0scripts\verify-native-katago.mjs" --capabilities-only >nul 2>nul
if errorlevel 1 goto :wait_bridge

:bridge_ready
"%NODE_EXE%" "%~dp0scripts\verify-native-katago.mjs" --capabilities-only
if errorlevel 1 goto :fail

"%NODE_EXE%" "%~dp0scripts\verify-native-leela-zero.mjs" --capabilities-only >nul 2>nul
if not errorlevel 1 (
  echo A verified Native Leela Zero bridge is already running on port %LEELA_BRIDGE_PORT%.
  goto :leela_bridge_ready
)

set "LEELA_LISTEN_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%LEELA_BRIDGE_PORT% .*LISTENING"') do set "LEELA_LISTEN_PID=%%P"
if defined LEELA_LISTEN_PID (
  echo Port %LEELA_BRIDGE_PORT% is occupied by PID %LEELA_LISTEN_PID%, but it is not the configured Leela Zero bridge.
  goto :fail
)

echo Starting Native Leela Zero bridge in a hidden background process...
for /f "delims=" %%P in ('call "%NODE_EXE%" "%~dp0scripts\start-detached-process.mjs" --cwd "%ROOT_DIR%" --stdout "%TEMP%\project10-leela-zero-bridge.out.log" --stderr "%TEMP%\project10-leela-zero-bridge.err.log" "%NODE_EXE%" "--env-file=%~dp0services\leela-zero-bridge\.env" "%~dp0services\leela-zero-bridge\src\server.mjs"') do set "LEELA_BRIDGE_PID=%%P"
if not defined LEELA_BRIDGE_PID (
  echo Failed to start the Native Leela Zero bridge.
  goto :fail
)
set "LEELA_BRIDGE_STARTED=1"

echo Waiting for Leela Zero model and OpenCL initialization...
set "LEELA_READY_WAIT=0"
:wait_leela_bridge
set /a LEELA_READY_WAIT+=1
if %LEELA_READY_WAIT% GTR 300 (
  echo Native Leela Zero did not become ready. See %TEMP%\project10-leela-zero-bridge.err.log
  goto :fail
)
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
"%NODE_EXE%" "%~dp0scripts\verify-native-leela-zero.mjs" --capabilities-only >nul 2>nul
if errorlevel 1 goto :wait_leela_bridge

:leela_bridge_ready
"%NODE_EXE%" "%~dp0scripts\verify-native-leela-zero.mjs" --capabilities-only
if errorlevel 1 goto :fail

if not exist "%~dp0services\sayuri-bridge\.env" (
  echo Optional Sayuri runtime is not installed. Existing website, KataGo, and Leela Zero features remain available.
  echo To enable Sayuri, run: npm run setup:sayuri
  goto :sayuri_bridge_done
)

"%NODE_EXE%" "%~dp0scripts\verify-native-sayuri.mjs" --live-only >nul 2>nul
if not errorlevel 1 (
  echo A Sayuri bridge is already running on port %SAYURI_BRIDGE_PORT%; its model remains lazy until selected.
  goto :sayuri_bridge_done
)

set "SAYURI_LISTEN_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%SAYURI_BRIDGE_PORT% .*LISTENING"') do set "SAYURI_LISTEN_PID=%%P"
if defined SAYURI_LISTEN_PID (
  echo Port %SAYURI_BRIDGE_PORT% is occupied by PID %SAYURI_LISTEN_PID%, but it is not the configured Sayuri bridge.
  goto :fail
)

echo Starting the optional Sayuri bridge without loading its model...
for /f "delims=" %%P in ('call "%NODE_EXE%" "%~dp0scripts\start-detached-process.mjs" --cwd "%ROOT_DIR%" --stdout "%TEMP%\project10-sayuri-bridge.out.log" --stderr "%TEMP%\project10-sayuri-bridge.err.log" "%NODE_EXE%" "--env-file=%~dp0services\sayuri-bridge\.env" "%~dp0services\sayuri-bridge\src\server.mjs"') do set "SAYURI_BRIDGE_PID=%%P"
if not defined SAYURI_BRIDGE_PID (
  echo Failed to start the optional Sayuri bridge.
  goto :fail
)
set "SAYURI_BRIDGE_STARTED=1"

set "SAYURI_LIVE_WAIT=0"
:wait_sayuri_bridge
set /a SAYURI_LIVE_WAIT+=1
if %SAYURI_LIVE_WAIT% GTR 30 (
  echo Sayuri bridge did not become live. See %TEMP%\project10-sayuri-bridge.err.log
  goto :fail
)
powershell -NoProfile -Command "Start-Sleep -Seconds 1"
"%NODE_EXE%" "%~dp0scripts\verify-native-sayuri.mjs" --live-only >nul 2>nul
if errorlevel 1 goto :wait_sayuri_bridge

:sayuri_bridge_done

echo Starting Vite preview in a hidden background process...
for /f "delims=" %%P in ('call "%NODE_EXE%" "%~dp0scripts\start-detached-process.mjs" --cwd "%ROOT_DIR%" --stdout "%TEMP%\project10-vite-preview.out.log" --stderr "%TEMP%\project10-vite-preview.err.log" "%NODE_EXE%" "%~dp0node_modules\vite\bin\vite.js" preview --outDir .vite-output --host 127.0.0.1 --port %PREVIEW_PORT% --strictPort') do set "PREVIEW_PID=%%P"
if not defined PREVIEW_PID (
  echo Failed to start the Vite preview.
  goto :fail
)
set "PREVIEW_STARTED=1"

set "PREVIEW_WAIT=0"
:wait_preview
set /a PREVIEW_WAIT+=1
if %PREVIEW_WAIT% GTR 60 (
  echo Vite preview did not return HTTP 200. See %TEMP%\project10-vite-preview.err.log
  goto :fail
)
powershell -NoProfile -Command "Start-Sleep -Seconds 1"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%PREVIEW_PORT%/' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if errorlevel 1 goto :wait_preview

if "%VERIFY_ONLY%"=="1" (
  echo Running a real 2000-visit Native KataGo analysis...
  "%NODE_EXE%" "%~dp0scripts\verify-native-katago.mjs"
  if errorlevel 1 goto :fail
  echo Running a real 3200-playout Native Leela Zero analysis...
  "%NODE_EXE%" "%~dp0scripts\verify-native-leela-zero.mjs"
  if errorlevel 1 goto :fail
  if exist "%~dp0services\sayuri-bridge\.env" (
    echo Running a real configured-playout Native Sayuri analysis...
    "%NODE_EXE%" "%~dp0scripts\verify-native-sayuri.mjs"
    if errorlevel 1 goto :fail
  )
  echo Local preview verification passed.
  call :cleanup
  endlocal
  exit /b 0
)

start "" "http://127.0.0.1:%PREVIEW_PORT%/"
echo AI Xiangqi is available at http://127.0.0.1:%PREVIEW_PORT%/
echo Native KataGo bridge is available at http://127.0.0.1:%BRIDGE_PORT%/
echo Native Leela Zero bridge is available at http://127.0.0.1:%LEELA_BRIDGE_PORT%/
if exist "%~dp0services\sayuri-bridge\.env" echo Sayuri bridge is available at http://127.0.0.1:%SAYURI_BRIDGE_PORT%/ and loads lazily.
echo Process IDs: preview=%PREVIEW_PID% katago=%BRIDGE_PID% leela-zero=%LEELA_BRIDGE_PID% sayuri=%SAYURI_BRIDGE_PID%
if "%NO_PAUSE%"=="0" pause
endlocal
exit /b 0

:build
set "VITE_KATAGO_BRIDGE=1"
"%NODE_EXE%" "%~dp0scripts\sync-engine-assets.mjs"
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\typescript\bin\tsc" -b
if errorlevel 1 exit /b 1
"%NODE_EXE%" "%~dp0node_modules\vite\bin\vite.js" build
exit /b %errorlevel%

:cleanup
if "%PREVIEW_STARTED%"=="1" if defined PREVIEW_PID taskkill /PID %PREVIEW_PID% /T /F >nul 2>nul
if "%BRIDGE_STARTED%"=="1" if defined BRIDGE_PID taskkill /PID %BRIDGE_PID% /T /F >nul 2>nul
if "%LEELA_BRIDGE_STARTED%"=="1" if defined LEELA_BRIDGE_PID taskkill /PID %LEELA_BRIDGE_PID% /T /F >nul 2>nul
if "%SAYURI_BRIDGE_STARTED%"=="1" if defined SAYURI_BRIDGE_PID taskkill /PID %SAYURI_BRIDGE_PID% /T /F >nul 2>nul
exit /b 0

:fail
call :cleanup
echo Operation failed. Only processes started by this script were stopped.
if "%NO_PAUSE%"=="0" pause
endlocal
exit /b 1
