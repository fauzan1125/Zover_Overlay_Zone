@echo off
title Hentikan Server ZoVer
echo ===========================================
echo   Menghentikan Server Multi-Chat ZoVer...
echo ===========================================
taskkill /F /IM node.exe >nul 2>&1
echo [OK] Server berhasil dimatikan.
timeout /t 2 >nul
exit /b
