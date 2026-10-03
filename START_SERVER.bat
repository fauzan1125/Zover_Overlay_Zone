@echo off
color 0A
title Server Multi-Chat Overlay
echo =======================================================
echo   Menjalankan Multi-Chat Overlay ^& Mbak Google Server
echo   Biarkan jendela hitam ini tetap terbuka saat live!
echo   (Untuk mematikan, cukup tutup jendela ini)
echo =======================================================
echo.
powershell.exe -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
