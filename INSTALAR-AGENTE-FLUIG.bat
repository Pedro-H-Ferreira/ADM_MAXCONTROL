@echo off
setlocal
title ADM MaxControl - Instalar Agente Fluig

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "INSTALLER=%ROOT%\agent\fluig-agent\scripts\install-windows-agent.ps1"

echo.
echo ============================================================
echo  ADM MaxControl - Instalador do Agente Fluig
echo ============================================================
echo.
echo Este instalador vai pedir:
echo  - Token gerado no botao "Parear agente" do portal ADM
echo  - URL base do Fluig
echo  - Usuario e senha do Fluig
echo.
echo Nao feche esta janela ate finalizar.
echo.

if not exist "%INSTALLER%" (
  echo ERRO: Instalador nao encontrado:
  echo "%INSTALLER%"
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -ProjectRoot "%ROOT%"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo Instalacao finalizada.
  echo Use VERIFICAR-AGENTE-FLUIG.bat para conferir status e logs.
) else (
  echo Instalacao falhou com codigo %EXITCODE%.
  echo Use VERIFICAR-AGENTE-FLUIG.bat para ver logs, se existirem.
)
echo.
pause
exit /b %EXITCODE%
