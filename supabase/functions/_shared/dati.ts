// Accesso ai dati di prezzo (Twelve Data) con cache condivisa nel database.
// Usato sia da "analizza" (richieste dei clienti) sia da "avvisi" (controllo giornaliero).
import { comprimi, daTwelveData, espandi } from "./analisi.ts";
import type { Barra } from "./analisi.ts";

export class ErroreServizio extends Error {
  stato: number;
  codice: string;
  extra: Record<string, unknown>;
  constructor(stato: number, codice: string, messaggio: string, extra: Record<string, unknown> = {}) {
    super(messaggio);
    this.stato = stato;
    this.codice = codice;
    this.extra = extra;
  }
}

export interface ConfigDati { tdKey: string; cacheOre: number; storicoGiorni: number }
export interface RisultatoDati { barre: Barra[]; aggiornato: string; scaricato: boolean }

export function creaDati(sb: any, cfg: ConfigDati) {
  async function scarica(ticker: string): Promise<Barra[]> {
    if (!cfg.tdKey) throw new ErroreServizio(500, "CONFIG", "Servizio dati non configurato (manca TWELVEDATA_API_KEY).");
    const url = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(ticker) +
      "&interval=1day&outputsize=" + cfg.storicoGiorni + "&apikey=" + cfg.tdKey;
    let dati: any;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
      dati = await r.json();
    } catch (_e) {
      throw new ErroreServizio(502, "ERRORE_DATI", "Servizio dati non raggiungibile, riprova tra poco.");
    }
    if (dati && (dati.status === "error" || dati.code)) {
      const msg = String(dati.message || "");
      if (Number(dati.code) === 429) {
        if (/day/i.test(msg)) {
          throw new ErroreServizio(429, "LIMITE_GIORNALIERO", "Limite giornaliero del servizio dati raggiunto. Riprova domani.", { riprova_tra: 3600 });
        }
        throw new ErroreServizio(429, "LIMITE_MINUTO", "Troppe richieste al minuto: riprovo tra qualche secondo.", { riprova_tra: 20 });
      }
      if ([400, 404].includes(Number(dati.code))) {
        throw new ErroreServizio(404, "TICKER_NON_TROVATO", "Ticker non trovato: " + ticker);
      }
      const c = Number(dati.code);
      console.error("TwelveData errore", ticker, c, msg);
      if (c === 401) throw new ErroreServizio(500, "CONFIG", "Chiave Twelve Data non valida o non riconosciuta (errore 401): controlla il secret TWELVEDATA_API_KEY in Supabase.");
      if (c === 403) throw new ErroreServizio(502, "PIANO_DATI", "Il piano Twelve Data in uso non permette questo titolo (errore 403): " + msg.slice(0, 120));
      throw new ErroreServizio(502, "ERRORE_DATI", "Errore dal servizio dati" + (c ? " (codice " + c + ")" : "") + (msg ? ": " + msg.slice(0, 120) : "") + ".");
    }
    return daTwelveData(dati && dati.values);
  }

  // soloCache=true: non scarica mai, usa solo la copia salvata se e' ancora fresca.
  // minAggiornato: la copia salvata vale solo se e' stata scaricata a quell'ora o dopo
  // (serve agli avvisi, che devono usare la chiusura DEFINITIVA e non un prezzo di meta' giornata).
  async function datiTitolo(ticker: string, soloCache = false, minAggiornato?: Date): Promise<RisultatoDati> {
    const { data: cache } = await sb.from("price_cache").select("dati, aggiornato_il").eq("ticker", ticker).maybeSingle();
    const quando = cache ? new Date(cache.aggiornato_il).getTime() : 0;
    const valida = !!cache && (!minAggiornato || quando >= minAggiornato.getTime());
    const etaOre = cache ? (Date.now() - quando) / 3.6e6 : Infinity;
    if (cache && valida && etaOre < cfg.cacheOre) return { barre: espandi(cache.dati), aggiornato: cache.aggiornato_il, scaricato: false };
    if (soloCache) throw new ErroreServizio(503, "NON_IN_CACHE", "Dato non ancora aggiornato");
    try {
      const barre = await scarica(ticker);
      if (barre.length < 60) throw new ErroreServizio(404, "DATI_INSUFFICIENTI", "Storico insufficiente per " + ticker);
      const ora = new Date().toISOString();
      await sb.from("price_cache").upsert({ ticker, dati: comprimi(barre), aggiornato_il: ora });
      return { barre, aggiornato: ora, scaricato: true };
    } catch (e) {
      // Problema temporaneo del servizio dati: uso l'ultima copia salvata (solo se accettabile)
      if (cache && valida && e instanceof ErroreServizio && ["LIMITE_MINUTO", "LIMITE_GIORNALIERO", "ERRORE_DATI"].includes(e.codice)) {
        return { barre: espandi(cache.dati), aggiornato: cache.aggiornato_il, scaricato: false };
      }
      throw e;
    }
  }

  return { datiTitolo, scarica };
}
