@echo off
setlocal enabledelayedexpansion

rem Settle - Windows installer
rem Crit Studio
rem
rem Double-click this file. It copies the panel into the CEP extensions folder,
rem turns on unsigned-extension loading, and checks the result. No admin rights
rem needed, since everything is written under the current user.

set "HERE=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions"
set "NAME=settle"

echo.
echo   Settle 0.2.2 - installer
echo   ------------------------
echo.

rem --- find the extension folder, whatever depth the unzip left it at --------

set "SRC="
if exist "%HERE%%NAME%\CSXS\manifest.xml" set "SRC=%HERE%%NAME%"
if not defined SRC if exist "%HERE%CSXS\manifest.xml" set "SRC=%HERE%"
if not defined SRC if exist "%HERE%%NAME%\%NAME%\CSXS\manifest.xml" set "SRC=%HERE%%NAME%\%NAME%"

if not defined SRC (
  echo   Could not find CSXS\manifest.xml near this script.
  echo   Keep install-windows.bat next to the "settle" folder and run it again.
  echo.
  pause
  exit /b 1
)

echo   Source:  %SRC%
echo   Target:  %DEST%\%NAME%
echo.

rem --- copy -------------------------------------------------------------------

if not exist "%DEST%" mkdir "%DEST%"

if exist "%DEST%\%NAME%" (
  echo   Replacing the existing install.
  rmdir /s /q "%DEST%\%NAME%"
)

mkdir "%DEST%\%NAME%"
xcopy "%SRC%\*" "%DEST%\%NAME%\" /E /I /Q /Y >nul

rem Development leftovers have no business in an install.
if exist "%DEST%\%NAME%\test_host.js" del /q "%DEST%\%NAME%\test_host.js"
if exist "%DEST%\%NAME%\test_physics.js" del /q "%DEST%\%NAME%\test_physics.js"
if exist "%DEST%\%NAME%\node_modules" rmdir /s /q "%DEST%\%NAME%\node_modules"

if exist "%DEST%\%NAME%\CSXS\manifest.xml" (
  echo   Copied.
) else (
  echo   Copy failed. manifest.xml is not where it should be.
  pause
  exit /b 1
)

rem --- debug mode -------------------------------------------------------------
rem
rem REG_SZ, not REG_DWORD. The DWORD form is the common mistake and CEP ignores
rem it, so the key looks present while doing nothing.

set "OK="
for %%v in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
  reg query "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode >nul 2>&1 && set "OK=!OK! %%v"
)

if defined OK (
  echo   Unsigned extensions enabled for CSXS:!OK!
) else (
  echo   Warning: could not confirm the debug flag. See the README.
)

rem --- done -------------------------------------------------------------------

echo.
echo   Installed.
echo.
echo   Now close After Effects completely, reopen it, and look under
echo   Window ^> Extensions ^> Settle. Some AE builds call the menu
echo   Window ^> Extensions (Legacy).
echo.
echo   If it does not appear, open this file and search for "settle":
echo   %TEMP%\csxs12-AEFT.log
echo.
pause
