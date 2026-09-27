@echo off
setlocal
cd /d "%~dp0"

set "PROJECT_PY=%~dp0.venv\Scripts\python.exe"
if exist "%PROJECT_PY%" goto run_start

set "PROJECT_PY=%~dp0.venv\Scripts\python3.exe"
if exist "%PROJECT_PY%" goto run_start

where python >nul 2>&1
if not errorlevel 1 set "PROJECT_PY=python.exe"
if not errorlevel 1 goto run_start

where python3 >nul 2>&1
if not errorlevel 1 set "PROJECT_PY=python3.exe"
if not errorlevel 1 goto run_start

goto no_python

:run_start
"%PROJECT_PY%" "%~dp0start.py"
set "EXIT_CODE=%ERRORLEVEL%"
goto finish

:no_python
echo Python was not found. Install Python 3.10 or newer and add it to PATH.
set "EXIT_CODE=1"

:finish
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
