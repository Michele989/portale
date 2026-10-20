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
  // Versione del formato salvato nella cache: 2 = storico lungo + prezzi corretti per i dividendi.
  const VERSIONE = 2;
  const STORICO_RIDOTTO = 1300;

  async function chiedi(ticker: string, n: number, adjust: boolean): Promise<Barra[]> {
    const url = "https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(ticker) +
      "&interval=1day&outputsize=" + n + (adjust ? "&adjust=all" : "") + "&apikey=" + cfg.tdKey;
    let dati: any;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
      dati = await r.json();
    } catch (_e) {
      throw new ErroreServizio(502, "ERRORE_DATI", "Servizio dati non raggiungibile, riprova tra poco.");
    }
    if (dati && (dati.status === "error" || dati.code)) {
      const msg = String(dati.message || "");
      const c = Number(dati.code);
      if (c === 429) {
        if (/day/i.test(msg)) {
          throw new ErroreServizio(429, "LIMITE_GIORNALIERO", "Limite giornaliero del servizio dati raggiunto. Riprova domani.", { riprova_tra: 3600 });
        }
        throw new ErroreServizio(429, "LIMITE_MINUTO", "Troppe richieste al minuto: riprovo tra qualche secondo.", { riprova_tra: 20 });
      }
      if (c === 404 || (c === 400 && /symbol|not found/i.test(msg))) {
        throw new ErroreServizio(404, "TICKER_NON_TROVATO", "Ticker non trovato: " + ticker);
      }
      console.error("TwelveData errore", ticker, c, msg);
      if (c === 401) throw new ErroreServizio(500, "CONFIG", "Chiave Twelve Data non valida o non riconosciuta (errore 401): controlla il secret TWELVEDATA_API_KEY in Supabase.");
      if (c === 403) throw new ErroreServizio(502, "PIANO_DATI", "Il piano Twelve Data in uso non permette questo titolo (errore 403): " + msg.slice(0, 120));
      if (c === 400) throw new ErroreServizio(400, "RICHIESTA_RIFIUTATA", msg.slice(0, 120));
      throw new ErroreServizio(502, "ERRORE_DATI", "Errore dal servizio dati" + (c ? " (codice " + c + ")" : "") + (msg ? ": " + msg.slice(0, 120) : "") + ".");
    }
    return daTwelveData(dati && dati.values);
  }

  // Prima prova storico lungo + prezzi corretti per i dividendi; se il piano li rifiuta
  // (errore di richiesta/piano) ripiega su storico ridotto, poi sul formato semplice.
  async function scarica(ticker: string): Promise<{ barre: Barra[]; corretti: boolean }> {
    if (!cfg.tdKey) throw new ErroreServizio(500, "CONFIG", "Servizio dati non configurato (manca TWELVEDATA_API_KEY).");
    const tentativi: Array<[number, boolean]> = [[cfg.storicoGiorni, true]];
    if (cfg.storicoGiorni > STORICO_RIDOTTO) tentativi.push([STORICO_RIDOTTO, true]);
    tentativi.push([STORICO_RIDOTTO, false]);
    let ultimo: unknown = null;
    for (const [n, adj] of tentativi) {
      try {
        const barre = await chiedi(ticker, n, adj);
        return { barre, corretti: adj };
      } catch (e) {
        ultimo = e;
        if (!(e instanceof ErroreServizio) || !["RICHIESTA_RIFIUTATA", "PIANO_DATI"].includes(e.codice)) throw e;
      }
    }
    if (ultimo instanceof ErroreServizio && ultimo.codice === "RICHIESTA_RIFIUTATA") {
      throw new ErroreServizio(502, "ERRORE_DATI", "Errore dal servizio dati: " + ultimo.message);
    }
    throw ultimo;
  }

  // soloCache=true: non scarica mai, usa solo la copia salvata se e' ancora fresca.
  // minAggiornato: la copia salvata vale solo se e' stata scaricata a quell'ora o dopo
  // (serve agli avvisi, che devono usare la chiusura DEFINITIVA e non un prezzo di meta' giornata).
  async function datiTitolo(ticker: string, soloCache = false, minAggiornato?: Date): Promise<RisultatoDati> {
    const { data: cache } = await sb.from("price_cache").select("dati, aggiornato_il").eq("ticker", ticker).maybeSingle();
    const quando = cache ? new Date(cache.aggiornato_il).getTime() : 0;
    const versioneOk = !!cache && !!cache.dati && Number(cache.dati.v) >= VERSIONE && !cache.dati.err;
    const valida = !!cache && (!minAggiornato || quando >= minAggiornato.getTime());
    const etaOre = cache ? (Date.now() - quando) / 3.6e6 : Infinity;
    if (cache && valida && versioneOk && etaOre < cfg.cacheOre) return { barre: espandi(cache.dati), aggiornato: cache.aggiornato_il, scaricato: false };
    if (soloCache) throw new ErroreServizio(503, "NON_IN_CACHE", "Dato non ancora aggiornato");
    try {
      const { barre, corretti } = await scarica(ticker);
      if (barre.length < 60) throw new ErroreServizio(404, "DATI_INSUFFICIENTI", "Storico insufficiente per " + ticker);
      const ora = new Date().toISOString();
      await sb.from("price_cache").upsert({ ticker, dati: { ...comprimi(barre), v: VERSIONE, adj: corretti ? 1 : 0 }, aggiornato_il: ora });
      return { barre, aggiornato: ora, scaricato: true };
    } catch (e) {
      // Problema temporaneo del servizio dati: uso l'ultima copia salvata (solo se accettabile)
      if (cache && valida && !(cache.dati && cache.dati.err) && e instanceof ErroreServizio && ["LIMITE_MINUTO", "LIMITE_GIORNALIERO", "ERRORE_DATI"].includes(e.codice)) {
        return { barre: espandi(cache.dati), aggiornato: cache.aggiornato_il, scaricato: false };
      }
      throw e;
    }
  }

  // Segna un titolo non scaricabile (ticker sconosciuto, storico corto, piano): il precaricamento
  // non lo ritenta per qualche ora e l'analisi lo riprova subito se un cliente lo chiede.
  async function segnaErrore(ticker: string) {
    await sb.from("price_cache").upsert({ ticker, dati: { b: [], v: VERSIONE, err: 1 }, aggiornato_il: new Date().toISOString() });
  }

  return { datiTitolo, scarica, segnaErrore };
}
