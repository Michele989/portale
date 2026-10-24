# Guida dell'amministratore

## 1. Flusso quotidiano (abilitare un cliente)
1. Il cliente si registra sul sito e **ti manda il suo username**.
2. Ricevi il pagamento (bonifico, PayPal, Satispay… fuori dal sito).
3. Sito → *Pannello admin* → sezione **Crea chiave**: scrivi l'username, premi la scorciatoia del piano (Base/Plus/Pro) → **Crea chiave**.
4. Il cliente è **già abilitato**: gli basta premere «Ricontrolla». Il codice (es. `MA-K7QX-2PDM-9TWH`) resta visibile nella tabella come riferimento; scrivi nella nota il pagamento ricevuto.

## 2. Gestione dalla tabella utenti
| Azione | Effetto |
|---|---|
| Nuova chiave | Sostituisce la chiave attiva con una nuova (usi azzerati al valore scelto). |
| + usi | Ricarica gli usi della chiave attiva (e, se vuoi, prolunga i giorni). |
| Disattiva / Riattiva | Blocca o sblocca subito l'accesso; gli usi restano. |
| Reset password | Genera una password temporanea da dare al cliente (la cambia da Impostazioni). |
| Elimina | Cancella account, chiavi e dati (richiesta GDPR di cancellazione). Irreversibile. |
Filtri: «Senza chiave» = persone registrate da abilitare; «Usi esauriti o scaduti» = clienti da ricontattare per il rinnovo.

## 3. Tariffario consigliato
Prezzi pensati per piccoli investitori italiani e per coprire i costi dati con pochi clienti. 1 uso = 1 titolo analizzato.

| Piano | Usi | Validità | Prezzo | Costo per uso |
|---|---|---|---|---|
| Prova | 20 | 7 giorni | gratis (1 per persona) | — |
| Base | 150 | 30 giorni | 5,90 € | ≈ 0,04 € |
| Plus | 450 | 30 giorni | 12,90 € | ≈ 0,03 € |
| Pro | 1200 | 30 giorni | 24,90 € | ≈ 0,02 € |
| Ricarica | +100 usi | stessa scadenza | 3,90 € | 0,039 € |

Perché così: una lista tipica di 11 titoli consuma 11 usi, quindi Base (150) ≈ 13 analisi complete al mese, cioè un controllo ogni due giorni; Plus ≈ una al giorno; Pro per chi controlla più volte al giorno o ha liste lunghe. Modificare i piani: `PIANI` in `public/config.js` (ridistribuisci la cartella `public`). Verifica sempre i prezzi della concorrenza prima del lancio.

## 4. Costi e pareggio (verifica i prezzi attuali sui siti ufficiali)
- Supabase e Netlify: gratuiti all'inizio.
- Twelve Data: gratis 8 richieste/min e 800/giorno. Basta per pochi clienti grazie alla cache di 20 ore condivisa tra tutti e al precaricamento notturno (`INSTALLA_PRECARICA.bat`). Se compaiono spesso errori «limite» passa al piano a pagamento (piano «Grow»: circa 79 $/mese ≈ 70 €, da verificare sul sito se mensile o annuale) e metti `PAUSA_MS: 0`. Pareggio indicativo: circa 12 clienti «Base» o 6 «Plus».
- Pareggio indicativo con il piano a pagamento: ≈ **5 clienti Base o 3 Plus** al mese. Sopra questa soglia ogni cliente in più è margine, al lordo di tasse e commissioni di incasso.
- Dominio personalizzato (facoltativo): ≈ 10–15 €/anno.

## 4 bis. Affidabilità: come leggere e cosa dire ai clienti
- **Scheda «Affidabilità»** (visibile ai clienti): registro reale dei segnali, calibrazione e statistiche su tutti i titoli. Il registro si riempie da solo a ogni analisi; un esito richiede fino a 40 giorni.
- Non pubblicizzare percentuali del registro finché non hai **almeno 100 segnali chiusi**: con pochi casi i numeri sono troppo instabili. Se la calibrazione risulta «non migliore del riferimento», dillo: è meglio ritoccare le promesse che perdere credibilità.
- Cosa puoi dire: «mostra il margine di errore», «ti dice quando i dati sono dubbi», «confronta ogni segnale con il caso e con compra-e-tieni», «registra i propri segnali reali». Cosa **non** puoi dire: «prevede», «guadagno garantito», percentuali di successo senza margine di errore.
- Il filtro «**In esaurimento**» nel pannello elenca i clienti con pochi usi o in scadenza: sono i rinnovi da proporre.
- Un'analisi con dati «gravi» (vecchi, salti anomali) non viene registrata e risulta con affidabilità bassa.

## 4 quater. Avvisi email: gestione
- Nel pannello vedi quanti clienti hanno gli avvisi attivi e quante email sono partite negli ultimi 7 giorni.
- Gli avvisi arrivano solo ai clienti con **consenso** e **chiave valida**; se la chiave scade o viene disattivata, smettono da soli.
- Se un cliente non li riceve: spam, mittente non verificato, nessuna posizione inserita, chiave scaduta, oppure il segnale è già stato inviato nei 7 giorni precedenti.
- Un avviso è un segnale tecnico a fine giornata (prezzi di chiusura), non un allarme in tempo reale: non promettere reazioni immediate.
- Controlla ogni tanto il consumo giornaliero su Twelve Data e i log delle funzioni (Supabase → Edge Functions → `avvisi` → Logs).

## 4 ter. Monitoraggio
Attiva il controllo giornaliero gratuito (README, punto 10): ti avvisa se login, analisi o permessi smettono di funzionare. Controlla anche, ogni tanto, la dashboard Supabase (Edge Functions → Logs) e Twelve Data (consumo giornaliero).

## 5. Sicurezza e buone pratiche
- Non condividere mai la chiave `service_role` né quella Twelve Data; non sono nel sito, solo nei *secrets* Supabase.
- Un solo admin attivo; usa una password lunga e unica per il tuo account.
- Fai un backup periodico (Supabase → Database → Backups / esportazione tabelle).
- Controlla la tabella: usi che scendono troppo in fretta possono indicare una chiave condivisa; puoi disattivare.

## 6. GDPR: richieste dei clienti
- Accesso/portabilità: esporta le righe dell'utente da Supabase (Table Editor) e invia.
- Cancellazione: pulsante **Elimina** nel pannello.
- Tieni aggiornati titolare e contatto in `config.js` e le pagine privacy/termini.

## 7. Checklist legale e fiscale (da fare PRIMA di vendere)
- [ ] **Legale**: fai rivedere termini, privacy e il posizionamento («segnale tecnico generico, non consulenza») da un avvocato o consulente. Offrire raccomandazioni personalizzate su strumenti finanziari può configurare attività riservata (consulenza in materia di investimenti, TUF/CONSOB/OCF); il sito è costruito per evitarlo: non personalizzare mai i segnali sulla situazione del singolo cliente e non promettere rendimenti.
- [ ] **Fiscale**: parla con un commercialista su partita IVA, regime (forfettario o altro), fatturazione/ricevute degli incassi anche sotto soglia, eventuale prestazione occasionale.
- [ ] **Lavoro dipendente**: controlla nel tuo contratto (clausole di esclusiva/non concorrenza, autorizzazioni per attività esterne) se puoi svolgere un'attività autonoma.
- [ ] **Termini dei fornitori**: verifica che la licenza Twelve Data consenta di mostrare/rielaborare i dati a clienti terzi nel piano scelto (alcuni piani gratuiti sono solo per uso personale: per vendere il servizio probabilmente serve un piano commerciale).
- [ ] **Privacy**: compila titolare e contatto; registra il trattamento; informativa visibile (già linkata in registrazione).

> Il punto sulla licenza dati è importante: con il piano gratuito il servizio va bene per le prove, ma per l'uso commerciale controlla i termini di Twelve Data prima di incassare.
