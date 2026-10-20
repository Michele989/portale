# Portale Monitor Azioni & ETF — installazione (≈ 30 minuti)

Accesso con **chiavi a usi** assegnate dall'amministratore (nessun pagamento online).
Architettura: sito statico (Netlify) + Supabase (login, database, funzioni server) + Twelve Data (prezzi).
La chiave Twelve Data resta **solo sul server**; nel browser c'è soltanto la anon key di Supabase (pubblica per progetto).

```
GUIDA_AVVIO_DA_ZERO.md   PARTI DA QUI: guida passo passo (Windows) dal file zip al sito online
INSTALLA_FUNZIONI.bat    pubblica le funzioni server (analizza, admin)
INSTALLA_AVVISI.bat      configura e pubblica gli avvisi email
public/      sito (index, admin, istruzioni, metodo, termini, privacy, disiscrizione, config.js)
supabase/    schema.sql, funzioni (analizza, admin, avvisi, disiscrivi), modello cron_avvisi.sql
tests/       collaudi automatici (facoltativi) e smoke test del sito vero
GUIDA_ADMIN.md   uso quotidiano, tariffario, costi, checklist legale/fiscale
```

## 1. Account necessari (tutti con piano gratuito)
Supabase (supabase.com), Netlify (netlify.com), Twelve Data (twelvedata.com → API key).

## 2. Supabase: progetto e database
1. New project (regione EU, es. Frankfurt). Annota la password del database.
2. **SQL Editor → New query**: incolla tutto `supabase/schema.sql` → Run. (Si può rieseguire senza danni.)
3. **Authentication → Providers → Email**: disattiva **«Confirm email»** (così il cliente entra subito e vede il suo username da comunicarti). Se preferisci tenerla attiva funziona uguale, ma il cliente deve prima confermare la mail.
4. **Project Settings → API**: copia *Project URL* e *anon public key* (servono al punto 5).

## 3. Funzioni server (Edge Functions)
Serve la CLI Supabase (`npm i -g supabase` oppure scoop/brew). Da una cartella con questo progetto:
```
supabase login
supabase link --project-ref <ID_PROGETTO>        # l'ID è nell'URL del progetto
supabase secrets set TWELVEDATA_API_KEY=<la tua chiave Twelve Data>
supabase functions deploy analizza
supabase functions deploy admin
```
Opzionali: `supabase secrets set CACHE_ORE=6 STORICO_GIORNI=1300`.
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` sono già disponibili alle funzioni: **non vanno impostati né copiati da nessuna parte**.

## 4. Il tuo account amministratore
1. Apri il sito (anche in locale, punto 5), **registrati** con la tua email/username.
2. In Supabase → SQL Editor:
```sql
insert into public.admins (user_id)
select id from auth.users where email = 'LA_TUA_EMAIL';
```
3. Ricarica il sito: in fondo alla pagina compare «Pannello admin».

## 5. Pubblicazione del sito
1. Apri `public/config.js` e compila: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TITOLARE`, `EMAIL_CONTATTO`, `CONTATTO_ADMIN` (+ nome servizio, prezzi se li cambi).
2. Netlify → *Add new site → Deploy manually* → trascina la cartella **`public`**. Ottieni un indirizzo `https://…netlify.app` (puoi collegare un dominio tuo).
3. Se ricevi errori CORS/redirect, in Supabase → Authentication → URL Configuration imposta *Site URL* sull'indirizzo Netlify.

## 6. Prova completa (checklist)
- [ ] Registro un secondo utente di prova (username, email, password, spunta termini).
- [ ] Vede «In attesa di abilitazione» con il suo username.
- [ ] Da admin: scrivo l'username → piano «Prova» → Crea chiave.
- [ ] L'utente di prova preme «Ricontrolla»: vede «Ti restano 20 usi».
- [ ] Analizza un solo titolo (aggiungi/rimuovi dalla lista): il contatore scende di 1.
- [ ] Ticker inesistente (es. `ZZZZ`): errore e uso **rimborsato**.
- [ ] Da admin: Disattiva → l'utente riceve «chiave disattivata»; Riattiva; «+ usi».
- [ ] Portafoglio: inserisco una posizione e «Aggiorna segnali».
- [ ] Reset password e eliminazione dell'utente di prova.

## 7. Prima di vendere
Compila i dati del titolare, **fai rivedere termini e privacy** da un professionista, verifica con il commercialista l'inquadramento fiscale e con il tuo contratto di lavoro la compatibilità di un'attività autonoma (vedi `GUIDA_ADMIN.md`). Mantieni sempre la dicitura «segnale tecnico, non consulenza».

## Note tecniche e limiti
- 1 uso = 1 titolo analizzato; se il servizio dati fallisce, l'uso viene rimborsato in automatico.
- I prezzi sono in cache condivisa per 6 ore: più clienti sullo stesso titolo = una sola richiesta a Twelve Data.
- Piano gratuito Twelve Data: 8 richieste/min, 800/giorno. Con molti clienti passa a un piano a pagamento e metti `PAUSA_MS: 0` in `config.js`.
- `STORICO_GIORNI=1300` (≈5 anni) è stato scelto per i backtest: alla **prima analisi reale** verifica che Twelve Data lo accetti; in caso contrario riduci il valore (es. 1000).
- Le notifiche di vendita funzionano solo con la pagina aperta nel browser.
- Collaudi automatici: `cd tests && npm install && npm test` (calcoli, affidabilità, schema/permessi, interfaccia, smoke test) e `npm run tipi` (controllo tipi delle funzioni). Non sostituiscono la prova con i servizi reali (punto 6).

## 8. Aggiornamento dalla versione precedente
Se avevi già installato la prima versione: **riesegui** `supabase/schema.sql` (è sicuro rieseguirlo: aggiunge spread, registro segnali e statistiche), poi `supabase functions deploy analizza` e ripubblica la cartella `public` su Netlify (le pagine nuove: `metodo.html`, PWA).

## 9. Recupero password via email
Il pulsante «Password dimenticata?» usa le email di Supabase.
1. **Authentication → URL Configuration**: *Site URL* = indirizzo del sito; aggiungi lo stesso indirizzo (`https://…netlify.app/index.html` e `https://…netlify.app/`) tra i *Redirect URLs*.
2. Il servizio email predefinito di Supabase ha limiti molto bassi (poche mail all'ora) ed è pensato per le prove: prima di avere clienti configura un tuo SMTP (**Authentication → SMTP Settings**; esistono servizi con piano gratuito, verifica i limiti attuali).
3. Prova: «Password dimenticata?» con la tua email → ricevi il link → scegli la nuova password.
Se la mail non arriva, resta valido il reset manuale dal pannello admin.

## 10. Controllo giornaliero gratuito del sito (smoke test)
Verifica pagine, login, permessi, analisi, scalo dell'uso e protezione del pannello admin, e ti avvisa se si rompe qualcosa.
1. Registra un account **di prova** (es. `collaudo`) e dal pannello admin dagli una chiave grande (es. 1000 usi, 365 giorni): ogni controllo consuma 1 uso.
2. Carica il progetto in un repository GitHub **privato** e in *Settings → Secrets and variables → Actions* crea: `SITE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`.
3. Il file `.github/workflows/smoke.yml` lo esegue ogni giorno; in caso di errore GitHub ti scrive per email. Puoi lanciarlo a mano da *Actions → Run workflow*.
4. In locale: `cd tests && SITE_URL=… SUPABASE_URL=… SUPABASE_ANON_KEY=… SMOKE_EMAIL=… SMOKE_PASSWORD=… node smoke_live.mjs`.
Il primo giorno guarda l'esito della riga «storico lungo»: conferma che `STORICO_GIORNI` è accettato.

## 11. App sul telefono (PWA)
Il sito è installabile: Chrome/Android «Installa app», Safari/iPhone «Aggiungi a schermata Home». Serve HTTPS (Netlify lo fornisce).

## 12. Avvisi email a fine giornata (dettagli tecnici)
Come funziona: ogni sera dopo la chiusura dei mercati USA (4 passate tra le 21:15 e le 22:15 UTC, lun-ven) la funzione `avvisi` legge i clienti che hanno **dato il consenso** (Impostazioni → Avvisi email), hanno almeno una posizione e una **chiave attiva non scaduta**, scarica i prezzi **definitivi** (solo dati scaricati dopo le 21:10 UTC), controlla stop-loss, stop ATR e obiettivo e invia **una sola email per cliente** con i segnali nuovi. Lo stesso segnale non viene ripetuto prima di 7 giorni. Dati vecchi o anomali = nessun avviso. Gli avvisi non consumano usi.

Secrets (li imposta `INSTALLA_AVVISI.bat`; manuale: `supabase secrets set NOME=valore`):

| Secret | Significato |
|---|---|
| `CRON_SECRET` | segreto (almeno 16 caratteri) che autorizza lo scheduler |
| `SITE_URL` | indirizzo del sito, senza `/` finale |
| `MAIL_PROVIDER` | `brevo` oppure `resend` |
| `BREVO_API_KEY` / `RESEND_API_KEY` | chiave del servizio scelto |
| `MAIL_FROM` | mittente, es. `Monitor <avvisi@tuodominio.it>` |
| `MAX_SCARICHI` (opz., 10) | titoli nuovi scaricati per passata |
| `PAUSA_MS` (opz., 7700) | pausa dopo ogni scarico; `0` con un piano dati a pagamento |

Funzioni da pubblicare con `--no-verify-jwt` (si autorizzano da sole): `avvisi` (segreto) e `disiscrivi` (token personale del cliente):
```
supabase functions deploy avvisi --no-verify-jwt
supabase functions deploy disiscrivi --no-verify-jwt
```
Pianificazione: `supabase/cron_avvisi.sql` (pg_cron, consigliato) oppure `.github/workflows/avvisi.yml` (GitHub Actions): **uno solo dei due**.
Prove (con `curl`, header `x-cron-secret`): corpo `{"test_a":"tua@mail.it"}` invia un'email di prova; `{"prova":true}` calcola ciò che verrebbe inviato senza inviare né registrare nulla.
Limiti: con il piano dati gratuito (8 richieste/min) ogni passata scarica al massimo `MAX_SCARICHI` titoli nuovi: circa 40 titoli diversi per sera; oltre, serve un piano a pagamento (`PAUSA_MS=0`, `MAX_SCARICHI` più alto). I titoli sono condivisi tra clienti: conta quelli *diversi*.


## Orizzonte di investimento (breve / medio / lungo)

Ogni analisi calcola anche tre studi (21, 63, 252 giorni di borsa) in `supabase/functions/_shared/orizzonti.ts`: 4 criteri a regole, studio storico (casi simili a oggi, periodi indipendenti), ventaglio simulato (bootstrap a blocchi senza tendenza) e verdetto favorevole/neutro/sfavorevole/non valutabile. Il front-end (`index.html`) mostra la classifica e lo studio per l'orizzonte scelto dall'utente (salvato nel browser). Test: `tests/test_orizzonti.mjs`. Nota onesta: sui dati casuali i verdetti non hanno alcun potere predittivo, come è giusto che sia; su dati reali la tenuta va verificata nel tempo (idea futura: registrare i verdetti nel registro dei segnali).
