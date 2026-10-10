@echo off
cd /d "%~dp0"
rem Start the server hidden (only if it is not already running), then open it as an app window.
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden }"
timeout /t 3 /nobreak >nul
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:3456 --window-size=1400,900
