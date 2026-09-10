@echo off
rem Settle - Windows uninstaller. Removes the panel only. The CEP debug flag is
rem left alone on purpose, since other unsigned panels you use depend on it.
set "DEST=%APPDATA%\Adobe\CEP\extensions\settle"
echo.
if exist "%DEST%" (
  rmdir /s /q "%DEST%"
  echo   Removed %DEST%
  echo   Restart After Effects to clear it from the Window menu.
) else (
  echo   Nothing installed at %DEST%
)
echo.
pause
