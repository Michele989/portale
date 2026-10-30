# Audit tecnico di Tickly

## Critico (nessuno aperto)
- Chiavi segrete solo nelle funzioni del server; nel sito solo la chiave pubblica. Verificato con test.
- Ogni tabella ha le regole RLS: il test `tabelle_senza_rls` deve restare vuoto.

## Importante
- **RSI**: usiamo la media semplice a 14 giorni (Cutler), non quella "smorzata" di Wilder. I valori differiscono di qualche punto. Documentato, non è un errore.
- **Dati gratuiti** (Twelve Data): 8 richieste/minuto, 800/giorno. Con molti utenti serve un piano a pagamento.
- **Seconda fonte** (Stooq): confronto automatico non verificabile da qui; si disattiva con `CONTROLLO_INCROCIATO=0`.
- **Trimestrali**: probabilmente non disponibili nel piano gratuito; il controllo è spento di default.
- **EUR/USD** non modellato: i rendimenti sono nella valuta del titolo.
- **Survivorship bias**: i titoli studiati sono quelli oggi esistenti; segnalato nel sito.
- **Avvisi di cambio verdetto** per email/push: non ancora presenti (solo stop/obiettivo).

## Rifinitura
- Lighthouse non misurato qui; lista già a pagine da 25 righe.
- Parere legale su Termini/Privacy consigliato prima della vendita; licenza di rivendita dati Twelve Data da verificare.
