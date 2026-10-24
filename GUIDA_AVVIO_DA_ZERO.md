# Guida di avvio da zero (Windows) — dal file zip al sito online

Tempo: circa 1 ora e mezza la prima volta. Costo: **0 €** (il dominio per le email è facoltativo, ~10 €/anno).
Le schermate dei servizi cambiano ogni tanto: se un nome non coincide, cerca la voce più simile.
Ogni passo ha un **«Devi vedere»**: se non lo vedi, fermati e non andare avanti.

---

## FASE 0 — Prepara il PC (10 minuti)

1. **Estrai lo zip**: tasto destro su `portale_monitor.zip` → *Estrai tutto…* → scegli `C:\` e chiama la cartella **`portale`**. Il risultato è `C:\portale` con dentro `public`, `supabase`, `INSTALLA_FUNZIONI.bat`, ecc.
2. **Installa Node.js**: vai su <https://nodejs.org>, scarica la versione **LTS**, installa premendo sempre *Avanti*.
   - Devi vedere: premi il tasto Windows, scrivi `cmd`, Invio, poi scrivi `node -v` → compare un numero (es. `v22.…`).

## FASE 1 — Chiave dei prezzi: Twelve Data (5 minuti)

1. <https://twelvedata.com> → *Sign up* (gratis).
2. Dashboard → **API Keys** → copia la chiave (una stringa lunga). Incollala per ora in un Blocco note: ti servirà tra poco.
3. ⚠️ **Prima di vendere** controlla nei termini di Twelve Data se il tuo piano permette di mostrare i dati a clienti terzi. Per provare da solo va bene il gratuito.

## FASE 2 — Il database: Supabase (20 minuti)

1. <https://supabase.com> → *Start your project* → registrati.
2. **New project**: nome `monitor`, scegli una **password del database** (salvala), regione **Central EU (Frankfurt)** → *Create*. Aspetta 1–2 minuti.
   - Devi vedere: la dashboard del progetto.
3. **Crea le tabelle**: menu a sinistra **SQL Editor** → *New query*. Apri con il Blocco note il file `C:\portale\supabase\schema.sql`, premi `Ctrl+A`, `Ctrl+C`, torna nel browser, incolla, premi **Run**.
   - Devi vedere: «Success. No rows returned». Se compare un errore rosso, copiamelo.
4. **Login senza conferma email**: *Authentication* → *Sign In / Providers* (o *Providers*) → **Email** → disattiva **Confirm email** → *Save*.
5. **Copia due dati**: *Project Settings* (ingranaggio) → **API**:
   - **Project URL** (tipo `https://abcdefgh.supabase.co`)
   - chiave **anon public** (NON la `service_role`, quella è segreta e non va mai incollata nel sito).
   - L'**ID del progetto** è la parte prima di `.supabase.co` (nell'esempio `abcdefgh`).

## FASE 3 — Le funzioni server (10 minuti, la parte tecnica è automatica)

1. In `C:\portale` fai **doppio clic su `INSTALLA_FUNZIONI.bat`**. Se Windows avvisa «PC protetto», scegli *Ulteriori informazioni → Esegui comunque* (il file è testo, lo puoi aprire col Blocco note per leggerlo).
2. Segui le domande nella finestra nera:
   - si apre il browser: autorizza l'accesso a Supabase (se chiede un codice, copialo e incollalo nella finestra);
   - incolla l'**ID del progetto**;
   - se chiede la password del database puoi premere Invio;
   - incolla la **chiave Twelve Data**.
3. Aspetta che finisca.
   - Devi vedere: «FATTO. Le funzioni "analizza" e "admin" sono online».
   - In Supabase → **Edge Functions** compaiono `analizza` e `admin`.
   - Se fallisce, rilancia il file; se persiste mandami il messaggio di errore.

## FASE 4 — Configura e pubblica il sito (15 minuti)

1. Apri con il Blocco note `C:\portale\public\config.js` e compila (tra virgolette, senza cambiare il resto):
   - `SUPABASE_URL`: il Project URL;
   - `SUPABASE_ANON_KEY`: la chiave anon public;
   - `TITOLARE`: il tuo nome e cognome;
   - `EMAIL_CONTATTO`: la tua email di contatto;
   - `CONTATTO_ADMIN`: come ti contattano i clienti (es. «WhatsApp 333 1234567»).
   Salva.
2. **Opzione A — Vercel + GitHub (consigliata, come Sweat)**:
   - <https://github.com> → *New repository* → nome `portale`, **Private** → *uploading an existing file* → trascina il CONTENUTO di `C:\portale` (il file `.gitignore` esclude da solo i file segreti; se non carichi `node_modules` va bene) → *Commit changes*.
   - <https://vercel.com> → accedi con GitHub → *Add New → Project* → scegli `portale` → **Root Directory: `public`** → *Framework Preset: Other*, nessun comando di build → *Deploy*.
   - Devi vedere: un indirizzo tipo `https://portale-xxx.vercel.app` con la pagina di accesso. Ogni modifica a un file su GitHub ripubblica il sito da sola.
   - Le funzioni server NON vanno su Vercel: le pubblica `INSTALLA_FUNZIONI.bat` (Fase 3). La chiave Twelve Data non va mai su GitHub/Vercel.
   **Opzione B — Netlify**: <https://app.netlify.com> → registrati → **Add new site → Deploy manually**. **Trascina la cartella `C:\portale\public`** (la cartella, non lo zip) nell'area indicata.
   - Devi vedere: un indirizzo tipo `https://nome-casuale.netlify.app`. Aprilo: compare la pagina di accesso.
   - (Facoltativo) *Site configuration → Change site name* per un nome più bello.
3. Torna in Supabase → **Authentication → URL Configuration**: *Site URL* = il tuo indirizzo (Vercel o Netlify); in *Redirect URLs* aggiungi `https://tuo-indirizzo/**` (con l'indirizzo vero del sito) → *Save*. (Serve al recupero password.)
4. **Ogni volta che modifichi un file in `public`** (es. `config.js`): con GitHub/Vercel carichi il file aggiornato su GitHub (*Add file → Upload files*) e il sito si aggiorna; con Netlify ritrascini la cartella.

## FASE 5 — Diventa amministratore e prova tutto (20 minuti)

1. Apri il sito → **Registrati** con username, email, password. Spunta i termini.
   - Devi vedere: «In attesa di abilitazione» con il tuo username.
2. In Supabase → SQL Editor → *New query*, scrivi (con la TUA email) e premi Run:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'LA_TUA_EMAIL';
   ```
   - Devi vedere: «Success. 1 row». Ricarica il sito: in fondo alla pagina compare **Pannello admin**.
3. **Abilita anche il tuo account** (da amministratore NON hai usi di default, quindi senza chiave non puoi analizzare nulla): nel Pannello admin scrivi il tuo username, scegli un piano (es. 1000 usi) e premi **Crea chiave**; poi sul sito premi «Ricontrolla».
4. **Crea un cliente di prova**: apri il sito in una **finestra anonima** (Ctrl+Maiusc+N), registra `prova1` con un'altra email.
5. Nel pannello admin: scrivi `prova1`, premi la scorciatoia **Prova**, **Crea chiave**.
6. Nella finestra anonima premi **«Ricontrolla»**: compare «Ti restano 20 usi».
7. Cerca un titolo scrivendone il nome (es. `Apple`, `oro`) o il ticker (es. `AAPL`); dall'elenco «Aggiungi un pacchetto» puoi aggiungere ETF a dividendi, settori USA, ecc. Poi premi **Analizza** (sul titolo o su tutta la lista): confermi, e dopo qualche secondo compare la scheda; il contatore scende di 1.
   - Devi vedere: scheda con prezzo, indicatori, affidabilità e grafico.
   - Alla prima analisi controlla che **non** compaia un errore sullo storico: se sì (messaggio sul numero di giorni), in Supabase → *Edge Functions → Secrets* aggiungi `STORICO_GIORNI` = `1000` e riprova.
8. Prova anche: ticker inesistente `ZZZZ` (errore e uso **rimborsato**), «Aggiungi posizione» nel Portafoglio, scheda **Affidabilità**, «Password dimenticata?» (vedi Fase 6, punto 4).

## FASE 6 — Avvisi email a fine giornata (30 minuti, facoltativa ma consigliata)

1. **Scegli il servizio email** (piano gratuito, verifica i limiti sul sito):
   - **Brevo** (<https://brevo.com>): più semplice, puoi partire senza dominio. Registrati → *Senders, domains & dedicated IPs → Senders* → aggiungi il tuo indirizzo e conferma la mail ricevuta → *SMTP & API → API Keys* → *Generate a new API key* → copia.
   - **Resend** (<https://resend.com>): richiede un dominio tuo verificato (DNS), migliore consegna.
   - ⚠️ Con un mittente `@gmail.com` le email spesso finiscono nello spam o vengono rifiutate: per clienti veri compra un dominio (~10 €/anno) e usa un indirizzo tipo `avvisi@tuodominio.it`.
2. In `C:\portale` doppio clic su **`INSTALLA_AVVISI.bat`** e rispondi alle domande (indirizzo del sito Netlify, servizio, chiave, mittente). Alla fine puoi scrivere la tua email: arriva un messaggio di **prova**.
   - Devi vedere: `"inviata":true` e l'email in posta (controlla anche lo spam).
3. **Attiva la pianificazione**: in Supabase → *Database → Extensions* attiva **pg_cron** e **pg_net**. Poi *SQL Editor* → apri `C:\portale\cron_avvisi_pronto.sql` (creato dallo script), copia tutto, incolla, Run.
   - Devi vedere: «Success». Verifica con `select jobname, schedule from cron.job;` → 4 righe `avvisi-sera-…`.
   - **Poi cancella** `cron_avvisi_pronto.sql` e `PROVA_AVVISI.bat` (contengono il segreto) oppure conservali al sicuro.
4. **Recupero password**: il servizio email predefinito di Supabase invia pochissime mail all'ora. Per i clienti configura il tuo servizio: *Authentication → SMTP Settings* → inserisci i dati SMTP del servizio scelto (Brevo: *SMTP & API → SMTP*). Prova «Password dimenticata?» con la tua email.
5. **Prova gli avvisi con un caso vero**: sul sito (account di prova) → *Impostazioni* → spunta **Avvisi email** → Salva. Nel *Portafoglio* inserisci `AAPL`, quantità 1, **prezzo di acquisto molto più alto** del prezzo attuale (es. +30%) e premi «Aggiorna segnali» (così il titolo ha i dati). Poi fai doppio clic su **`PROVA_AVVISI.bat`**: mostra cosa verrebbe inviato (senza inviare). Vedrai `invii` con l'utente e il titolo. Gli avvisi reali partono da soli la sera, dopo la chiusura dei mercati USA, e ripetono lo stesso segnale al massimo ogni 7 giorni.
6. Provato che funziona? Nel sito **togli** la posizione e la spunta di prova.

## FASE 7 — Controllo giornaliero automatico (facoltativa, 15 minuti)

Ti avvisa via email se il sito si rompe. Vedi `README.md`, punto 10 (serve un account GitHub gratuito e un account «collaudo» con una chiave da 1000 usi).

## FASE 8 — Prima di vendere a persone vere

- [ ] **Licenza dati** Twelve Data: piano e termini adatti alla rivendita.
- [ ] **Termini e privacy**: fai rivedere i testi da un professionista (sono bozze).
- [ ] **Commercialista**: partita IVA, regime, fatturazione/ricevute.
- [ ] **Contratto di lavoro** (Capgemini): verifica se puoi svolgere un'attività autonoma e se serve un'autorizzazione.
- [ ] **Dominio e mittente email** tuoi, per avvisi e recupero password.
- [ ] **Beta** con 2–3 persone fidate per 2–3 settimane.
- [ ] Non usare le percentuali del registro nel marketing finché non hai almeno 100 segnali chiusi.

## Se qualcosa non va

| Sintomo | Cosa fare |
|---|---|
| Il sito dice «non è ancora configurato» | `config.js` non compilato o cartella non ricaricata su Netlify (Fase 4). |
| Errore rosso eseguendo `schema.sql` | Copia l'errore: di solito si risolve rieseguendo lo script intero. |
| «Sessione scaduta» / analisi non parte | Le funzioni non sono pubblicate: rilancia `INSTALLA_FUNZIONI.bat`; guarda *Edge Functions → Logs* in Supabase. |
| «Servizio dati non configurato» | Manca la chiave Twelve Data: rilancia `INSTALLA_FUNZIONI.bat`. |
| «Troppe richieste al minuto» | Normale col piano gratuito: il sito riprova da solo; liste lunghe richiedono qualche minuto. |
| Registrazione: «controlla la tua email» | Non hai disattivato *Confirm email* (Fase 2, punto 4). |
| Il pannello admin non compare | Rifai la query `insert into public.admins…` con l'email esatta di registrazione. |
| Le email non arrivano | Spam; mittente non verificato; limiti del piano gratuito; prova `INSTALLA_AVVISI.bat` di nuovo. |
| Un file `.bat` si chiude subito | Aprilo da *Prompt dei comandi* (`cd C:\portale` poi il nome del file) per leggere l'errore. |

## Extra: precaricamento notturno (consigliato)
1. In Supabase → SQL Editor: incolla tutto `supabase\schema.sql` → Run.
2. Doppio clic su `INSTALLA_FUNZIONI.bat` (aggiorna le funzioni).
3. Doppio clic su `INSTALLA_PRECARICA.bat`.
4. Supabase → Database → Extensions: attiva `pg_cron` e `pg_net`.
5. SQL Editor: incolla `cron_precarica_pronto.sql` → Run. Poi cancella quel file.
