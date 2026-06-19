@echo off
setlocal
cd /d "%~dp0.."
set "ENDODECK_BOOT_LOG=%CD%\endodeck-electron-background.log"
npx electron . --background
