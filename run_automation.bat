@echo off
title BPS Import and Export Automation
cd /d "%~dp0"
echo ======================================================================
echo           BPS INDONESIA IMPORT/EXPORT 1-CLICK AUTOMATION
echo ======================================================================
echo.
echo Starting automation...
echo.

node run.js

echo.
echo ======================================================================
echo Process finished. Press any key to close this window.
echo ======================================================================
pause >nul
