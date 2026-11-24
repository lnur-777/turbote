@echo off
cd /d "%~dp0"
if not exist ".env" goto noenv
findstr /b /c:"BOT_TOKEN=BURAYA" ".env" >nul && goto notoken
if not exist "node_modules" call npm install
node src\index.js
pause
exit /b

:noenv
copy /y ".env.example" ".env" >nul
:notoken
echo.
echo  .env faylinda BOT_TOKEN yazilmayib.
echo  Notepad acilacaq: BURAYA_TOKENI_YAZ yerine BotFather-dan aldigin tokeni yaz,
echo  Ctrl+S ile yadda saxla, Notepad-i bagla ve start.bat-i yeniden ac.
echo.
notepad ".env"
pause