@echo off
title Affentrader
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Affentrader.ps1"
if errorlevel 1 pause
