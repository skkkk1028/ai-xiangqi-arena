@echo off
setlocal
cd /d "%~dp0"

echo Building AI Xiangqi for Cloudflare Pages...
call pnpm build
if errorlevel 1 (
  echo Build failed. Keep this window open and check the error above.
  pause
  exit /b 1
)

echo Uploading the production build to Cloudflare Pages...
call pnpm dlx wrangler pages deploy .vite-output --project-name ai-xiangqi-arena-public --branch main
if errorlevel 1 (
  echo Deployment failed. Confirm that Wrangler is logged in and the Pages project exists.
  pause
  exit /b 1
)

echo Deployment completed. Wrangler printed the public URL above.
pause
endlocal
