@echo off
rem Starts the climbing-wall backend (Flask + Phidget stream) on Windows.
rem Windows equivalent of run_backend.sh (.sh scripts don't run on Windows).
rem On first run it creates the Python environment and installs dependencies.
rem
rem Requires once per machine:
rem   - Python 3 installed and on PATH (python.org)
rem   - the Phidget22 Windows drivers (https://www.phidgets.com/docs/OS_-_Windows)
rem     so the sensor boards can be opened over USB.
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
    echo First run - creating the Python environment...
    python -m venv venv || goto :error
    venv\Scripts\python.exe -m pip install -r requirements.txt || goto :error
)
venv\Scripts\python.exe app.py
pause
goto :eof

:error
echo.
echo Setup failed. Is Python 3 installed and on PATH?
pause
