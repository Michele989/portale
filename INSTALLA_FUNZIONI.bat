@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo  INSTALLAZIONE FUNZIONI SERVER - Supabase
echo ============================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non e' installato. Installalo da https://nodejs.org ^(versione LTS^)
  echo poi chiudi questa finestra e fai di nuovo doppio clic su questo file.
  pause
  exit /b 1
)
echo PASSO 1 - Si aprira' il browser: autorizza l'accesso a Supabase.
echo           Se chiede un codice di verifica, copialo dal browser e incollalo qui.
call npx --yes supabase@latest login
if errorlevel 1 goto errore
echo.
set REF=
set /p REF=PASSO 2 - Incolla l'ID del progetto Supabase (es. abcdefghijkl) e premi Invio: 
if "%REF%"=="" goto errore
echo           Se chiede la password del database puoi premere Invio per saltare.
call npx --yes supabase@latest link --project-ref %REF%
if errorlevel 1 goto errore
echo.
set TD=
set /p TD=PASSO 3 - Incolla la chiave Twelve Data e premi Invio: 
if "%TD%"=="" goto errore
call npx --yes supabase@latest secrets set TWELVEDATA_API_KEY=%TD%
if errorlevel 1 goto errore
echo.
echo PASSO 4 - Pubblico le funzioni (puo' richiedere un paio di minuti)...
call :deploy analizza ""
if errorlevel 1 goto errore
call :deploy admin ""
if errorlevel 1 goto errore
echo Aggiorno anche il precaricamento notturno (se lo hai installato)...
call :deploy precarica "--no-verify-jwt"
echo.
echo ============================================================
echo  FATTO. Le funzioni "analizza" e "admin" sono online.
echo  Per gli avvisi email esegui poi INSTALLA_AVVISI.bat
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
echo *** Qualcosa non ha funzionato. Leggi il messaggio sopra: di solito basta
echo     rilanciare questo file. Se il problema resta, copia il messaggio di errore.
pause
exit /b 1
