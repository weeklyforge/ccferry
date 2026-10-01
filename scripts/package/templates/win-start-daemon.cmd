@echo off
rem ccferry client supervisor (installed next to the exe; credentials live in
rem the user profile). Self-locating: %~dp0 is the install directory. The
rem loop, not the task's RestartOnFailure policy, is the crash supervisor:
rem that policy has a fixed restart budget which, once consumed, never
rem resets for a long-running process that exits non-zero.
for /f "usebackq tokens=1,* delims==" %%A in ("%USERPROFILE%\.ccferry\daemon.env") do set "%%A=%%B"
if not exist "%USERPROFILE%\.ccferry\logs" mkdir "%USERPROFILE%\.ccferry\logs"
cd /d "%~dp0"
:loop
ccferry-client.exe >> "%USERPROFILE%\.ccferry\logs\daemon.log" 2>&1
echo %date% %time% ccferry-client.exe exited with code %errorlevel%, restarting in 5s >> "%USERPROFILE%\.ccferry\logs\daemon.log"
ping -n 6 127.0.0.1 >nul
goto loop
