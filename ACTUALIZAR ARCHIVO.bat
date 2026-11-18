@echo off
rem Actualizacion diaria del archivo local de Lechuza Legal (la ejecuta Windows a las 9:00).
rem Baja las listas de las ultimas 2 semanas que falten. Lo ya guardado no se vuelve a bajar.
rem El registro queda en data\indexar.log
cd /d "%~dp0"
if not exist node_modules call npm install >nul 2>nul
node --disable-warning=ExperimentalWarning indexar.js --dias=14 --descargas=2 >nul 2>&1
