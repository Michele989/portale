@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  INSTALLAZIONE PRECARICAMENTO NOTTURNO
echo  (esegui prima INSTALLA_FUNZIONI.bat)
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non e' installato: vedi INSTALLA_FUNZIONI.bat
  pause
  exit /b 1
)
set REF=
if exist "supabase\.temp\project-ref" set /p REF=<"supabase\.temp\project-ref"
if "%REF%"=="" set /p REF=ID del progetto Supabase ^(es. abcdefghijkl^): 
if "%REF%"=="" goto errore
set URL=https://%REF%.supabase.co
echo Progetto: %URL%
for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')"') do set SEG=%%i
if "%SEG%"=="" goto errore
echo.
echo Imposto il segreto sul server...
call npx --yes supabase@latest secrets set PRECARICA_SECRET=%SEG%
if errorlevel 1 goto errore
echo Pubblico la funzione precarica...
call :deploy precarica "--no-verify-jwt"
if errorlevel 1 goto errore
echo Preparo il file per la pianificazione...
powershell -NoProfile -Command "(Get-Content 'supabase\cron_precarica.sql' -Raw).Replace('__PROJECT_URL__','%URL%').Replace('__PRECARICA_SECRET__','%SEG%') | Set-Content -Encoding UTF8 'cron_precarica_pronto.sql'"
echo.
echo ============================================================
echo  FATTO. Ora, in Supabase:
echo   a) SQL Editor: incolla tutto supabase\schema.sql e premi Run
echo      ^(aggiunge l'elenco dei titoli da precaricare^)
echo   b) Database -^> Extensions: attiva pg_cron e pg_net
echo   c) SQL Editor: apri cron_precarica_pronto.sql ^(nella cartella
echo      del portale^), copia tutto, incolla, Run
echo  Poi CANCELLA cron_precarica_pronto.sql: contiene il segreto.
echo ============================================================
pause
exit /b 0

:deploy
call npx --yes supabase@latest functions deploy %1 %~2 --use-api
if not errorlevel 1 exit /b 0
echo Riprovo senza --use-api...
call npx --yes supabase@latest functions deploy %1 %~2
exit /b %errorlevel%

:errore
echo.
echo *** Qualcosa non ha funzionato. Leggi il messaggio sopra e rilancia il file.
pause
exit /b 1
