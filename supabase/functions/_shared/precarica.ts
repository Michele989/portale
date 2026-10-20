// Precaricamento notturno dei prezzi: dopo la chiusura dei mercati scarica i titoli che i
// clienti seguono (lista di controllo e portafoglio), cosi' di giorno le analisi sono
// immediate e non consumano il limite del servizio dati.
import { ErroreServizio } from "./dati.ts";

export interface DepsPrecarica {
  daAggiornare: (limite: number) => Promise<string[]>;
  scarica: (ticker: string) => Promise<unknown>; // lancia ErroreServizio se non riesce; restituisce le barre
  dopo?: (ticker: string, barre: unknown) => Promise<void>; // registro verdetti: errori ignorati
  segnaErrore: (ticker: string) => Promise<void>;
  attendi: (ms: number) => Promise<void>;
  adesso: () => number;
}

export interface RiepilogoPrecarica {
  richiesti: number; scaricati: number; errori: number; stop: string | null;
}

export async function eseguiPrecarica(
  d: DepsPrecarica, opz: { massimo: number; pausaMs: number; durataMaxMs: number },
): Promise<RiepilogoPrecarica> {
  const inizio = d.adesso();
  const lista = await d.daAggiornare(opz.massimo);
  const r: RiepilogoPrecarica = { richiesti: lista.length, scaricati: 0, errori: 0, stop: null };
  for (let i = 0; i < lista.length; i++) {
    if (d.adesso() - inizio > opz.durataMaxMs) { r.stop = "tempo"; break; }
    if (i > 0) await d.attendi(opz.pausaMs); // 8 richieste al minuto sul piano gratuito
    try {
      const barre = await d.scarica(lista[i]);
      r.scaricati++;
      if (d.dopo) { try { await d.dopo(lista[i], barre); } catch (_e) { /* il registro non blocca il precaricamento */ } }
    } catch (e) {
      if (e instanceof ErroreServizio) {
        if (e.codice === "LIMITE_GIORNALIERO") { r.stop = "limite_giornaliero"; break; }
        if (e.codice === "LIMITE_MINUTO") { r.stop = "limite_minuto"; break; }
        if (e.codice === "CONFIG") { r.stop = "configurazione"; break; }
        if (["TICKER_NON_TROVATO", "DATI_INSUFFICIENTI", "PIANO_DATI"].includes(e.codice)) {
          r.errori++;
          await d.segnaErrore(lista[i]);
          continue;
        }
        r.errori++; // errore temporaneo: si riprova alla prossima passata
        continue;
      }
      throw e;
    }
  }
  return r;
}
