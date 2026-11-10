@echo off
title Magnum CPA - Update Client Reviews
color 0B

echo ================================================
echo   MAGNUM CPA - Update Client Reviews
echo   reviews.xlsx  -^>  website  -^>  GitHub
echo ================================================
echo.

:: Work in the folder this file lives in (the website folder)
cd /d "%~dp0"

:: Check the tools we need
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed. Download from: https://git-scm.com/download/win
    goto :fail
)
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed. Download from: https://www.python.org/downloads/
    goto :fail
)
python -c "import openpyxl" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing the Excel reader for Python ^(one time only^)...
    python -m pip install --user --quiet openpyxl
    if errorlevel 1 goto :fail
)

:: Excel keeps a hidden ~$ lock file while the workbook is open
if exist "~$reviews.xlsx" (
    echo reviews.xlsx is still open in Excel.
    echo Save it, close Excel, then run this again.
    goto :fail
)

:: Don't mix in hand edits to index.html that haven't been published yet
git diff --quiet -- index.html
if %errorlevel% neq 0 (
    echo index.html has other changes that are not on GitHub yet.
    echo Publish or undo those first ^(or ask Claude^), then run this again.
    goto :fail
)

echo Getting latest changes from GitHub...
git pull --ff-only origin main
if %errorlevel% neq 0 (
    echo ERROR: could not get the latest version from GitHub. See the message above.
    goto :fail
)

echo.
echo Building the review cards from reviews.xlsx...
python tools\build_reviews.py .
if %errorlevel% neq 0 goto :fail

:: Publish only the spreadsheet and the page it changes
git add index.html reviews.xlsx
git diff --cached --quiet -- index.html reviews.xlsx
if %errorlevel% equ 0 (
    echo.
    echo Nothing changed - the website already shows these reviews.
    goto :done
)
git commit -q -m "Update client reviews from reviews.xlsx (%date% %time:~0,5%)" -- index.html reviews.xlsx
if %errorlevel% neq 0 goto :fail

echo.
echo Pushing to GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo ERROR: Push failed. See the message above.
    goto :fail
)

echo.
echo ================================================
echo   SUCCESS! Reviews published.
echo   They appear on www.magnumcpa.com in about a minute
echo   ^(press Ctrl+F5 if the old ones still show^).
echo ================================================
goto :done

:fail
echo.
echo Nothing was published.
:done
echo.
pause
