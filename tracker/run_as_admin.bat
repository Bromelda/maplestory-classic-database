@echo off
rem Starts the tracker as administrator, so its hotkeys work with the game in front. The game runs as administrator, and Windows
rem doesn't show a normal program any keys pressed while an administrator program is in front. Windows asks you first.
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
    echo Couldn't find the tracker's Python in .venv. Use run.bat instead: the rest works, but not the hotkeys in the game.
    pause
    exit /b 1
)
powershell -NoProfile -Command "Start-Process -FilePath '%~dp0.venv\Scripts\pythonw.exe' -ArgumentList 'maple_exp.py' -WorkingDirectory '%~dp0.' -Verb RunAs"
