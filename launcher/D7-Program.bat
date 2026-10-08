@echo off
rem D7 Program launcher. Starts the app's local server and opens it in its own window (Edge app mode: no tabs, no address bar).
rem   D7-Program.bat            asks which version (1 is chosen after a few seconds)
rem   D7-Program.bat latest     this folder, live: includes changes that are not pushed yet (port 3002)
rem   D7-Program.bat stable     what is on GitHub master, in its own copy that updates itself on every start (port 3003)
setlocal enableextensions
title D7 Program
set "REPO=%~dp0.."
for %%I in ("%REPO%") do set "REPO=%%~fI"
set "STABLE=%USERPROFILE%\D7-Program-App"
set "MODE=%~1"

if "%MODE%"=="" (
  echo.
  echo   D7 Program
  echo.
  echo   [1] Latest work  - this folder, live, including changes not pushed yet
  echo   [2] Stable       - what is on GitHub master; updates itself each time you start it
  echo.
  choice /c 12 /t 6 /d 1 /m "Pick one (1 starts by itself in 6 seconds)"
  if errorlevel 2 (set "MODE=stable") else (set "MODE=latest")
)
if /i "%MODE%"=="stable" goto stable

:latest
set "PORT=3002"
cd /d "%REPO%"
if not exist node_modules (
  echo Installing the app's parts for the first time...
  call npm install || goto fail
)
call :alive %PORT%
if errorlevel 1 start "D7 Program (latest work) - close this window to stop it" /min cmd /c npm run dev -- -p %PORT%
goto open

:stable
set "PORT=3003"
if not exist "%STABLE%\package.json" (
  echo First start: downloading the app from GitHub...
  git clone https://github.com/D7-Ryan-Dillon/D7-Program.git "%STABLE%" || goto fail
)
copy /y "%REPO%\.env.local" "%STABLE%\.env.local" >nul
cd /d "%STABLE%"
call :alive %PORT%
if not errorlevel 1 goto open
set "OLD=none"
if exist .next\BUILD_ID for /f %%H in ('git rev-parse HEAD') do set "OLD=%%H"
echo Checking GitHub for updates...
git pull --ff-only || goto fail
for /f %%H in ('git rev-parse HEAD') do set "NEW=%%H"
if "%OLD%"=="%NEW%" goto startstable
echo Updating the app (a minute or two)...
call npm install || goto fail
call npm run build || goto fail
:startstable
start "D7 Program (stable) - close this window to stop it" /min cmd /c npm start -- -p %PORT%
goto open

:open
echo Starting... the window opens when the app is ready.
set /a TRIES=0
:wait
call :alive %PORT%
if not errorlevel 1 goto launch
set /a TRIES+=1
if %TRIES% GEQ 90 goto fail
timeout /t 2 /nobreak >nul
goto wait

:launch
start "" msedge --app=http://localhost:%PORT% 2>nul || start "" chrome --app=http://localhost:%PORT% 2>nul || start "" http://localhost:%PORT%
exit /b 0

:alive
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:%1 -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
exit /b %errorlevel%

:fail
echo.
echo Something went wrong (see the messages above). Press any key to close.
pause >nul
exit /b 1
