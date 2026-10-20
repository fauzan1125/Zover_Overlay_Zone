@echo off
color 0A
title Server Multi-Chat Overlay & TikTok Live Connector
echo =======================================================
echo   Menjalankan Multi-Chat Overlay & Mbak Google Server
echo   Port: http://localhost:8765
echo   Biarkan jendela hitam ini tetap terbuka saat live!
echo   (Untuk mematikan, cukup tutup jendela ini)
echo =======================================================
echo.

set PATH=C:\Program Files\nodejs;%LOCALAPPDATA%\Programs\node;%PATH%

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [INFO] Node.js belum terdeteksi di sistem Anda.
  where winget >nul 2>nul
  if %ERRORLEVEL% EQU 0 (
    echo [INFO] Memasang Node.js LTS otomatis melalui winget...
    winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
    set PATH=C:\Program Files\nodejs;%PATH%
  ) else (
    echo [PERINGATAN] Silakan pasang Node.js dari https://nodejs.org/ untuk fitur Native TikTok.
    echo Beralih sementara ke server PowerShell...
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0server.ps1"
    pause
    exit /b
  )
)

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [PERINGATAN] Node.js belum selesai dipasang atau perlu restart terminal.
  echo Beralih sementara ke server PowerShell...
  powershell.exe -ExecutionPolicy Bypass -File "%~dp0server.ps1"
  pause
  exit /b
)

if not exist "%~dp0node_modules\tiktok-live-connector\" (
  echo [INFO] Mengunduh dependensi library pertama kali (npm install)...
  call npm install --no-audit --no-fund
  echo [INFO] Instalasi dependensi selesai.
  echo.
)

node "%~dp0server.js"

pause
