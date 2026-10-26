@echo off
:: ================================================================
::  MAGNUM CPA — Restore a saved version
::  Puts the project files back to how they were in a saved version.
::  It first saves the CURRENT files as a safety zip, so a restore can
::  always be undone. Nothing goes live until you run sync.bat.
:: ================================================================
setlocal EnableDelayedExpansion
title Magnum CPA — Restore a version
color 0E

:: Work from the project folder (the folder above this one)
cd /d "%~dp0.."

if not exist "versions\snapshots\*.zip" (
    echo No saved versions found in versions\snapshots\
    echo Use save-version.bat to create one.
    pause
    exit /b 1
)

echo ================================================
echo   Saved versions (newest last)
echo ================================================
dir /b /o:n "versions\snapshots\*.zip"
echo.
echo See versions\CHANGELOG.md for what each version contains.
echo.
set /p PICK=Type the version name to restore (e.g. 2026-10-26_1430):
set PICK=!PICK:.zip=!
if not exist "versions\snapshots\!PICK!.zip" (
    echo ERROR: versions\snapshots\!PICK!.zip does not exist.
    pause
    exit /b 1
)

:: Safety copy of the current files before overwriting anything
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
echo.
echo Saving current files first as versions\snapshots\before-restore_%STAMP%.zip ...
"%SystemRoot%\System32\tar.exe" -a -c -f "versions\snapshots\before-restore_%STAMP%.zip" --exclude=.git --exclude=versions --exclude=node_modules --exclude=.wrangler --exclude=.claude .

:: Unpack the chosen version over the project folder
echo Restoring !PICK! ...
"%SystemRoot%\System32\tar.exe" -x -f "versions\snapshots\!PICK!.zip"
if errorlevel 1 (
    echo ERROR: restore failed. Your current files were saved in
    echo versions\snapshots\before-restore_%STAMP%.zip
    pause
    exit /b 1
)

echo.
echo ================================================
echo   Restored !PICK! on this computer.
echo   Check the site locally, then run sync.bat to
echo   publish it to magnumcpa.com.
echo   (Files created AFTER that version are not deleted.)
echo ================================================
echo.
pause
