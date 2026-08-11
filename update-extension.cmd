@echo off
REM Double-click or: update-extension.cmd [-DevHost] [-NoRestart] [-SkipInstall]
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-extension.ps1" %*
