@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% equ 0 (
  node scripts/setup-netlify-access.mjs
) else (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/setup-netlify-access.mjs
)
pause
