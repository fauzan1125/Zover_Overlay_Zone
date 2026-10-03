@echo off
color 0B
title ZoVer - Automated Test Runner
echo =======================================================
echo   ZoVer (Multi-Chat Overlay) - Test Runner
echo =======================================================
echo.
echo [1/2] Menjalankan Pengujian Server ^& Security (PowerShell)...
powershell.exe -ExecutionPolicy Bypass -File "%~dp0tests\test_server.ps1"
echo.
echo [2/2] Membuka Test Suite Client di Browser...
start "" "%~dp0tests\test_suite.html"
echo.
echo Pengujian selesai! Periksa hasil di jendela browser Anda.
pause
