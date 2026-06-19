@echo off
setlocal
title ADM MaxControl - Remover Agente Fluig

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "UNINSTALLER=%ROOT%\agent\fluig-agent\scripts\uninstall-windows-agent.ps1"

echo.
echo ============================================================
echo  ADM MaxControl - Remover Agente Fluig
echo ============================================================
echo.
echo Esta opcao remove a tarefa agendada do agente.
echo.
choice /C SN /N /T 15 /D N /M "Tambem remover configuracao local e credencial salva? [S/N] "
if errorlevel 2 (
  set "REMOVE_CONFIG="
) else (
  set "REMOVE_CONFIG=-RemoveLocalConfig"
)

if not exist "%UNINSTALLER%" (
  echo ERRO: Removedor nao encontrado:
  echo "%UNINSTALLER%"
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%UNINSTALLER%" %REMOVE_CONFIG%
set "EXITCODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXITCODE%
