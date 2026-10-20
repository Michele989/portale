@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  INSTALLAZIONE AVVISI EMAIL
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
echo.
set SITE=
set /p SITE=1) Indirizzo del tuo sito Netlify (es. https://mio-sito.netlify.app, senza / finale): 
if "%SITE%"=="" goto errore
set PROV=
set /p PROV=2) Servizio email: scrivi brevo oppure resend: 
if /i "%PROV%"=="brevo" (set KEYNAME=BREVO_API_KEY) else (set PROV=resend& set KEYNAME=RESEND_API_KEY)
set MKEY=
set /p MKEY=3) Incolla la chiave API del servizio email (%PROV%): 
if "%MKEY%"=="" goto errore
set MFROM=
set /p MFROM=4) Mittente, es. Monitor ^<avvisi@tuodominio.it^> (per Brevo l'indirizzo gia' verificato): 
if "%MFROM%"=="" goto errore
for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')"') do set CRON=%%i
if "%CRON%"=="" goto errore
echo.
echo Imposto i dati sul server...
call npx --yes supabase@latest secrets set %KEYNAME%=%MKEY% MAIL_PROVIDER=%PROV% SITE_URL=%SITE% "MAIL_FROM=%MFROM%" CRON_SECRET=%CRON%
if errorlevel 1 goto errore
echo Pubblico le funzioni avvisi e disiscrivi...
call :deploy avvisi "--no-verify-jwt"
if errorlevel 1 goto errore
call :deploy disiscrivi "--no-verify-jwt"
if errorlevel 1 goto errore

echo Preparo i file per la pianificazione...
powershell -NoProfile -Command "(Get-Content 'supabase\cron_avvisi.sql' -Raw).Replace('__PROJECT_URL__','%URL%').Replace('__CRON_SECRET__','%CRON%') | Set-Content -Encoding UTF8 'cron_avvisi_pronto.sql'"
(
echo @echo off
echo echo Prova degli avvisi: calcola cosa verrebbe inviato, senza inviare nulla.
echo curl.exe -s -X POST "%URL%/functions/v1/avvisi" -H "x-cron-secret: %CRON%" -H "Content-Type: application/json" -d "{\"prova\":true}"
echo echo.
echo pause
) > PROVA_AVVISI.bat

echo.
set DEST=
set /p DEST=5) Scrivi la TUA email per ricevere un messaggio di prova (Invio per saltare): 
if not "%DEST%"=="" (
  echo Invio la prova...
  curl.exe -s -X POST "%URL%/functions/v1/avvisi" -H "x-cron-secret: %CRON%" -H "Content-Type: application/json" -d "{\"test_a\":\"%DEST%\"}"
  echo.
  echo Se vedi "inviata":true controlla la posta ^(anche lo spam^).
)
echo.
echo ============================================================
echo  FATTO. Ora, in Supabase:
echo   a) Database -^> Extensions: attiva pg_cron e pg_net
echo   b) SQL Editor: apri il file cron_avvisi_pronto.sql ^(nella cartella
echo      del portale^), copia tutto, incolla, Run
echo  Poi CANCELLA cron_avvisi_pronto.sql e PROVA_AVVISI.bat dopo averli
echo  usati o conservali al sicuro: contengono il segreto degli avvisi.
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
