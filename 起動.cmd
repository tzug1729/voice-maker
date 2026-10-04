@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。README.md の案内から Node.js 20 以降をインストールしてください。
  pause
  exit /b 1
)

for /f "tokens=1 delims=.v" %%v in ('node --version') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Node.js 20 以降が必要です。現在のバージョン:
  node --version
  pause
  exit /b 1
)

echo ブラウザーを開きます。VOICEVOXデスクトップアプリも起動してください。
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3000'"
echo このウィンドウを閉じるとアプリが終了します。
node backend/server.mjs
pause
