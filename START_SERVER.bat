@echo off
color 0A
title Server Multi-Chat Overlay ^& TikTok Live Connector
echo =======================================================
echo   Menjalankan Multi-Chat Overlay ^& Mbak Google Server
echo   Port: http://localhost:8765
echo   Biarkan jendela hitam ini tetap terbuka saat live!
echo   (Untuk mematikan, cukup tutup jendela ini)
echo =======================================================
echo.

cd /d "%~dp0"

set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\node;%APPDATA%\npm;%PATH%"

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 goto :check_deps

echo [INFO] Node.js belum terdeteksi di sistem Anda.
where winget >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto :fallback_powershell

echo [INFO] Memasang Node.js LTS otomatis melalui winget...
winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LOCALAPPDATA%\Programs\node;%APPDATA%\npm;%PATH%"

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 goto :check_deps

:fallback_powershell
echo [PERINGATAN] Silakan pasang Node.js dari https://nodejs.org/ untuk fitur Native TikTok.
echo Beralih sementara ke server PowerShell...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
exit /b

:check_deps
if exist "%~dp0node_modules\tiktok-live-connector\" if exist "%~dp0node_modules\ws\" goto :start_node

echo [INFO] Mengunduh dependensi library pertama kali...
call npm install --no-audit --no-fund
echo [INFO] Instalasi dependensi selesai.
echo.

:start_node
echo [OK] Menjalankan server Node.js (ZoVer)...
echo.
node "%~dp0server.js"

pause


