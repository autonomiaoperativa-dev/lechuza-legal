@echo off
rem Descarga las listas de acuerdos de SLP (ultimos 10 anos, todos los juzgados) al archivo local.
rem Se puede cerrar esta ventana en cualquier momento: al abrirla de nuevo retoma donde iba.
rem Para solo actualizar los ultimos dias:  DESCARGAR ARCHIVO.bat --dias=7
cd /d "%~dp0"
title Lechuza Legal - descargando archivo
where node >nul 2>nul || (
  echo Falta instalar Node.js. Descargalo de https://nodejs.org ^(version LTS^).
  pause
  exit /b
)
if not exist node_modules call npm install
node --disable-warning=ExperimentalWarning indexar.js %*
pause
