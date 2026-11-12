@echo off
setlocal
cd /d "%~dp0"

where.exe node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer using README.md.
  pause
  exit /b 1
)

for /f "tokens=1 delims=.v" %%v in ('node --version') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR (
  echo Could not read the Node.js version.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 20 (
  echo Node.js 20 or newer is required. Installed version:
  node --version
  pause
  exit /b 1
)

echo Starting the local app. Start VOICEVOX Desktop to generate audio.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3000'"
echo Keep this window open while using the app. Press Ctrl+C to stop.
node backend/server.mjs
if errorlevel 1 echo The app stopped with an error. Check the message above.
pause
