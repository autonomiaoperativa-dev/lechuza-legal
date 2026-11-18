@echo off
rem Abre Lechuza Legal en esta computadora (Windows).
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Falta instalar Node.js. Descargalo de https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  pause
  exit /b
)
if not exist node_modules (
  echo Instalando lo necesario por primera vez...
  call npm install
)
start "" http://localhost:3077
echo Lechuza Legal funcionando en http://localhost:3077. Cierra esta ventana para apagarlo.
node server.js
pause
