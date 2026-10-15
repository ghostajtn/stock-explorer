@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem Start the server hidden, but only if it is not already running.
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 3456 -State Listen -ErrorAction SilentlyContinue)) { Start-Process node -ArgumentList 'server.js' -WindowStyle Hidden -WorkingDirectory '%~dp0' }"

rem Wait up to 20 seconds until the server really answers.
powershell -NoProfile -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest http://localhost:3456/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
if errorlevel 1 (
  echo The server did not start. Open a terminal in this folder and run: node server.js
  pause
  exit /b 1
)

rem Open it as a Chrome app window (falls back to your default browser).
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" goto launch
start "" http://localhost:3456
exit /b 0

:launch
start "" "%CHROME%" --app=http://localhost:3456 --window-size=1400,900
exit /b 0
