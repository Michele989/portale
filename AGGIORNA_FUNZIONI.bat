@echo off
setlocal
cd /d "%~dp0"
set REF=bwrjriwjfzzvreiuwlni
echo Aggiorno le funzioni analizza e precarica...
call npx --yes supabase@latest functions deploy analizza --use-api --project-ref %REF%
if errorlevel 1 goto errore
call npx --yes supabase@latest functions deploy precarica --no-verify-jwt --use-api --project-ref %REF%
if errorlevel 1 goto errore
echo.
echo FATTO
pause
exit /b 0
:errore
echo.
echo ERRORE: mandami lo screenshot
pause
exit /b 1
