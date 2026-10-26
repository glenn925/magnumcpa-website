@echo off
:: ================================================================
::  MAGNUM CPA — Save a version
::  Double-click this BEFORE making risky changes (or right after a
::  change you're happy with). It saves a full copy of the project as
::  a .zip in versions\snapshots\ and a matching restore point (git
::  tag) on GitHub, then notes it in versions\CHANGELOG.md.
::  To go back to a saved version, use restore-version.bat.
:: ================================================================
setlocal EnableDelayedExpansion
title Magnum CPA — Save a version
color 0B

:: Work from the project folder (the folder above this one)
cd /d "%~dp0.."

:: Timestamp used as the version name, e.g. 2026-10-26_1430
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i

echo ================================================
echo   Save a version of the website
echo ================================================
echo.
set /p DESC=Short description of this version (e.g. "before new hero"):
if "!DESC!"=="" set DESC=No description

:: 1) Zip a full copy of the project (skips git internals, old
::    snapshots, and the Worker's downloaded node_modules)
if not exist "versions\snapshots" mkdir "versions\snapshots"
echo.
echo Creating versions\snapshots\%STAMP%.zip ...
"%SystemRoot%\System32\tar.exe" -a -c -f "versions\snapshots\%STAMP%.zip" --exclude=.git --exclude=versions --exclude=node_modules --exclude=.wrangler --exclude=.claude .
if errorlevel 1 (
    echo ERROR: could not create the zip file.
    pause
    exit /b 1
)

:: 2) Add a line to the changelog (PowerShell writes it, so special
::    characters in the description can't break this script)
powershell -NoProfile -Command "Add-Content -Encoding utf8 -Path 'versions\CHANGELOG.md' -Value ('- **' + $env:STAMP + '** - ' + $env:DESC)"

:: 3) Save the restore point to GitHub as well
git add versions\CHANGELOG.md
git commit -m "Save version %STAMP%" >nul
git tag "v%STAMP%"
git pull --ff-only origin main
git push origin main
git push origin "v%STAMP%"

echo.
echo ================================================
echo   Saved version %STAMP%
echo   Zip:      versions\snapshots\%STAMP%.zip
echo   GitHub:   tag v%STAMP%
echo ================================================
echo.
pause
