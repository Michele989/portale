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

## Aggiunte gratuite (novembre)
- Controllo falsi positivi (99%), confronto con SPY, volatilità, liquidità, cambio EUR/USD (informativo), orizzonti in contrasto, dati anomali.
- Riquadro «Le più solide oggi», pallino, prova senza soldi, «cosa è cambiato», storico verdetti.
- Backtest cieco 2022 (`tests/backtest_cieco.mjs`): pronto e testato su dati finti; NON ancora eseguito su dati reali (serve la chiave Twelve Data, circa 8 minuti ogni 60 titoli).
- Limite noto: il cambio EUR/USD non entra nel verdetto, è solo mostrato; vale solo per ticker senza punto (titoli USA).
- Limite noto: la «prova senza soldi» e il «cosa è cambiato» sono salvati solo nel browser (se cambi telefono ripartono da zero).
- Non fatto: avvisi per email quando cambia il verdetto (oggi c'è solo l'avviso dentro il sito).

## Rifinitura
- Lighthouse non misurato qui; lista già a pagine da 25 righe.
- Parere legale su Termini/Privacy consigliato prima della vendita; licenza di rivendita dati Twelve Data da verificare.
