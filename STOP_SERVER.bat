@echo off
title Hentikan Server ZoVer
cd /d "%~dp0"
echo ===========================================
echo   Menghentikan Server Multi-Chat ZoVer...
echo ===========================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
echo [OK] Server ZoVer (Port 8765) berhasil dimatikan.
timeout /t 2 >nul
exit /b

