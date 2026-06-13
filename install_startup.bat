@echo off
:: ─────────────────────────────────────────────────────────────────────────────
::  Job Tracker Sync — Windows Startup Installer
::  Run this ONCE (double-click) to make sync_script.py start automatically
::  every time Windows boots. Runs silently in the background.
:: ─────────────────────────────────────────────────────────────────────────────

SET SCRIPT_DIR=%~dp0
SET SCRIPT_PATH=%SCRIPT_DIR%sync_script.py
SET TASK_NAME=JobTrackerSync

echo Installing Job Tracker Sync as a Windows Scheduled Task...

:: Remove old task if it exists
schtasks /delete /tn "%TASK_NAME%" /f >nul 2>&1

:: Create task: runs at login, repeats every 1 minute to ensure it stays alive
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "pythonw \"%SCRIPT_PATH%\"" ^
  /sc ONLOGON ^
  /delay 0000:30 ^
  /rl HIGHEST ^
  /f

IF %ERRORLEVEL% EQU 0 (
    echo.
    echo  SUCCESS! Sync task installed.
    echo  The sync script will now run automatically every time you log in.
    echo.
    echo  Starting it now for the first time...
    start "" pythonw "%SCRIPT_PATH%"
    echo  Running in background. Check sync_log.txt for activity.
) ELSE (
    echo.
    echo  ERROR: Could not install task. Try running as Administrator.
    echo  Right-click install_startup.bat ^> Run as administrator
)

echo.
pause
