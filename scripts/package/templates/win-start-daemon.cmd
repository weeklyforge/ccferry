@echo off
rem ccferry client launcher (installed next to the exe; credentials live in
rem the user profile). Self-locating: %~dp0 is the install directory.
for /f "usebackq tokens=1,* delims==" %%A in ("%USERPROFILE%\.ccferry\daemon.env") do set "%%A=%%B"
if not exist "%USERPROFILE%\.ccferry\logs" mkdir "%USERPROFILE%\.ccferry\logs"
cd /d "%~dp0"
ccferry-client.exe >> "%USERPROFILE%\.ccferry\logs\daemon.log" 2>&1
