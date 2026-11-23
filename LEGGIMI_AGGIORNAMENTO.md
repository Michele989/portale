# Aggiornamento: previsioni e validazione (4 passi)

1. **Database** — Supabase → SQL Editor → New query → incolla tutto il file `SOLO_NUOVO_SQL.sql` → Run. Deve dire "Success".
2. **Funzioni** — doppio clic su `AGGIORNA_FUNZIONI.bat` (due deploy; se chiede "Deploy?" rispondi Yes). Deve finire con FATTO.
3. **GitHub** — carica tutto il contenuto della cartella (cartelle `public`, `supabase`, `strumenti`, `tests` e i file). Per il file `.github/workflows/validazione.yml`: GitHub → Add file → Create new file → nome `.github/workflows/validazione.yml` → incolla il contenuto → Commit.
4. **Validazione** — GitHub → Actions → **Validazione** → Run workflow. Dopo 5-15 minuti apri la riga verde → job `valida` → passo "Esegui la validazione": in fondo c'è la CONCLUSIONE. Il risultato compare anche nel tab Affidabilità del sito.

Da stanotte il programma scrive le previsioni di tutti i titoli. I primi risultati veri arrivano dopo 21 giorni di borsa (circa metà dicembre).
