@echo off
rem Actualizacion diaria del archivo local de Lechuza Legal (la ejecuta Windows a las 9:00).
rem 1) Baja las listas de las ultimas 2 semanas que falten. Lo ya guardado no se vuelve a bajar.
rem 2) Revisa las alertas (expedientes y nombres) y envia los correos de novedades.
rem El registro queda en data\indexar.log
cd /d "%~dp0"
if not exist node_modules call npm install >nul 2>nul
node --disable-warning=ExperimentalWarning indexar.js --dias=14 --descargas=2 >nul 2>&1
node --disable-warning=ExperimentalWarning revisar-alertas.js >nul 2>&1
