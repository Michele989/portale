# Guida per continuare (sito già online)

Parti da qui: l'account, il database, il sito e le funzioni li hai già fatti.

## 1. Aggiorna il sito con i file nuovi (5 minuti)
1. Estrai il nuovo `portale_monitor.zip` in `C:\` e conferma la sovrascrittura.
2. Carica su GitHub, nel repository `portale`, **tutti i file della cartella `public`** (sovrascrivendo quelli esistenti; ci sono file nuovi come `catalogo.js`).
   Su GitHub: *Add file → Upload files* → trascina i file → *Commit changes*.
   Carica anche la cartella `supabase` (contiene le funzioni aggiornate).
3. Aspetta 1 minuto che Vercel pubblichi, poi apri il sito e premi `Ctrl+F5`.
   - Devi vedere: il campo «Cerca per nome o ticker» e la voce «Aggiungi un pacchetto di titoli».

## 1 bis. Aggiorna server e database (5 minuti)
1. In Supabase → *SQL Editor*: incolla tutto `C:\portale\supabase\schema.sql` e premi *Run*.
2. Doppio clic su `C:\portale\INSTALLA_FUNZIONI.bat` (aggiorna le funzioni server).

## 1 ter. Precaricamento notturno (5 minuti)
1. Doppio clic su `C:\portale\INSTALLA_PRECARICA.bat` e segui le istruzioni a video.
2. Supabase → *Database → Extensions*: attiva `pg_cron` e `pg_net`.
3. *SQL Editor*: incolla `C:\portale\cron_precarica_pronto.sql` → Run. Poi cancella quel file.
4. Prima analisi dopo l'aggiornamento: se un titolo dà errore, copiami il messaggio (verifica che lo storico lungo funzioni col piano gratuito; altrimenti passa da solo a uno storico più corto).

## 1 quater. Registro automatico + studio di gruppo (3 minuti, una volta sola)
(Novità: confronto con il gruppo, nuova grafica chiara/scura con filtri, accesso admin blindato (un solo admin, nessuno può farsi admin dall'app). Serve rilanciare `schema.sql` e `INSTALLA_FUNZIONI.bat`.)
1. Carica su GitHub i file della cartella `public` (è cambiato `admin.html`) e la cartella `supabase`.
2. Supabase → *SQL Editor*: incolla tutto `schema.sql` → Run.
3. Doppio clic su `INSTALLA_FUNZIONI.bat`, poi su `INSTALLA_PRECARICA.bat` (se l'hai già fatto, rifallo: aggiorna la funzione).
4. Da qui in poi è tutto automatico. Controlla ogni tanto il *Pannello admin*, sezione «Affidabilità reale dei verdetti»: i primi casi chiusi compaiono dopo circa un mese (breve termine).

## 2. Abilita il tuo account (2 minuti)
Da amministratore non hai usi finché non ti crei una chiave.
1. Apri **Pannello admin** (in fondo alla pagina).
2. Scrivi il tuo username, scegli un piano (es. 1000 usi), premi **Crea chiave**.
3. Torna sul sito e premi **Ricontrolla**.
   - Devi vedere: «Ti restano 1000 usi».

## 3. Prova ricerca ed ETF (5 minuti)
1. Nel campo di ricerca scrivi `oro`: compare GLD. Prova anche `Apple`, `semiconduttori`.
2. Apri «Aggiungi un pacchetto di titoli» e aggiungi quello che ti serve.
3. Premi **Analizza** su un solo titolo (costa 1 uso) e controlla che compaia la scheda.

## 4. Prova gli avvisi email (10 minuti)
1. Nel sito: *Impostazioni* → spunta **Avvisi email** → Salva.
2. *Portafoglio* → aggiungi `AAPL`, quantità 1, prezzo di acquisto **30% più alto** del prezzo attuale.
3. Torna in *Analisi*, analizza `AAPL`, così il titolo ha i dati.
4. Fai doppio clic su `PROVA_AVVISI.bat`. Mostra cosa verrebbe inviato, senza inviare nulla.
   - Se non funziona, copiami **tutto** il testo della finestra nera.
5. Finito il test, togli la posizione e la spunta di prova.

## 5. Prima di vendere
- [ ] Licenza dati Twelve Data adatta alla rivendita
- [ ] Termini e privacy rivisti da un professionista
- [ ] Commercialista (partita IVA, fatturazione)
- [ ] Contratto Capgemini: verifica se puoi svolgere un'attività autonoma
- [ ] Dominio tuo per email di avvisi e recupero password
- [ ] Prova con 2-3 persone fidate per 2-3 settimane
- [ ] Non usare le percentuali del registro nel marketing prima di 100 segnali chiusi
