# Checklist sicurezza (esito)
| Controllo | Esito |
|---|---|
| RLS attiva su tutte le tabelle | OK (test automatico) |
| Nessuna chiave segreta nel sito | OK |
| Limite richieste (30/min per utente) | OK |
| Funzioni cron protette da segreto | OK |
| Esporta/cancella i propri dati | OK |
| Backup | Workflow `backup.yml` (attivare con variabile BACKUP_ATTIVO=1 e segreto DATABASE_URL) |
| 2FA su Supabase, GitHub, Vercel | DA FARE a mano |

## Ripristino backup
1. Crea un nuovo progetto Supabase. 2. `pg_restore --no-owner -d "<stringa connessione>" backup.dump`. 3. Riesegui `schema.sql` e ridistribuisci le funzioni con INSTALLA_FUNZIONI.bat.
