@echo off
setlocal
cd /d "%~dp0"

if not exist ".vite-output\index.html" (
  echo Preparing the production preview for the first run...
  call pnpm build
  if errorlevel 1 (
    echo Build failed. Keep this window open and check the error above.
    pause
    exit /b 1
  )
)

start "AI Xiangqi preview" /b cmd /c call "%~dp0node_modules\.bin\vite.cmd" preview --host 127.0.0.1 --port 4173 --strictPort
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173/"

echo AI Xiangqi is available at http://127.0.0.1:4173/
echo Closing this window will not stop the preview. Restarting Windows will stop it.
endlocal
