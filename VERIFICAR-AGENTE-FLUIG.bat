@echo off
setlocal
title ADM MaxControl - Verificar Agente Fluig

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "DIAG=%ROOT%\agent\fluig-agent\scripts\diagnose-windows-agent.ps1"

echo.
echo ============================================================
echo  ADM MaxControl - Diagnostico do Agente Fluig
echo ============================================================
echo.

if not exist "%DIAG%" (
  echo ERRO: Diagnostico nao encontrado:
  echo "%DIAG%"
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%DIAG%"
set "EXITCODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXITCODE%
