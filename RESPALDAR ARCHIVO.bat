@echo off
rem Copia de seguridad semanal de Lechuza Legal (la ejecuta Windows los domingos a las 3:00).
rem Copia lechuza.db (listas, alertas, usuarios, SAT) a C:\LechuzaLegal\respaldos, en otro disco
rem distinto del archivo original (D:). Conserva las 2 copias mas recientes.
rem El registro queda en respaldo.log, dentro de la carpeta de datos.
cd /d "%~dp0"
node --disable-warning=ExperimentalWarning respaldar.js >nul 2>&1
