// =========================================================================
// BACKTEST CIECO: il modello viene fatto girare ogni mese di un periodo "mai visto"
// (default: 2022, anno di ribassi) usando SOLO i dati disponibili fino a quel giorno.
// Poi si controlla cosa è successo davvero e si pubblica il risultato, anche se brutto.
// Limiti dichiarati: solo titoli che esistono ancora oggi (i falliti mancano); senza dati di gruppo.
// Uso (rete + chiave): TWELVEDATA_API_KEY=... node --experimental-strip-types backtest_cieco.mjs [anno]
// =========================================================================
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { analizzaOrizzonti, ORIZZONTI } from "../supabase/functions/_shared/orizzonti.ts";

const NOMI = ["breve", "medio", "lungo"];

// barreDi(ticker) -> barre dal piu' recente (come in cache) oppure null
export async function backtestCieco(barreDi, tickers, { anno = 2022, passo = 21 } = {}) {
  const inizio = anno + "-01-01", fine = anno + "-12-31";
  const acc = {}; for (const k of NOMI) acc[k] = { favorevole: [], neutro: [], sfavorevole: [], tutti: [] };
  let titoli = 0;
  for (const t of tickers) {
    const rec = await barreDi(t); if (!rec) continue;
    const cron = rec.slice().reverse();
    const iIni = cron.findIndex((b) => b.d >= inizio);
    if (iIni < 300) continue; // serve storico prima del periodo
    titoli++;
    for (let i = iIni; i < cron.length && cron[i].d <= fine; i += passo) {
      const visibile = cron.slice(0, i + 1); // solo il passato
      let st; try { st = analizzaOrizzonti(visibile, { senzaVentaglio: true }); } catch (_e) { continue; }
      for (const k of NOMI) {
        const h = ORIZZONTI[k].giorni; if (i + h >= cron.length) continue; // esito non ancora noto
        const rend = (cron[i + h].c / cron[i].c - 1) * 100, v = st[k].verdetto;
        acc[k].tutti.push(rend);
        if (acc[k][v]) acc[k][v].push(rend);
      }
    }
  }
  const mediana = (a) => { if (!a.length) return null; const o = a.slice().sort((x, y) => x - y), m = Math.floor(o.length / 2); return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };
  const riga = (a) => ({ n: a.length, saliti: a.length ? (a.filter((x) => x > 0).length / a.length) * 100 : null, mediana: mediana(a) });
  const out = { anno, titoli, orizzonti: {} };
  for (const k of NOMI) out.orizzonti[k] = { tutti: riga(acc[k].tutti), favorevole: riga(acc[k].favorevole), neutro: riga(acc[k].neutro), sfavorevole: riga(acc[k].sfavorevole) };
  return out;
}

export function rapporto(r) {
  const f = (x, d = 0) => (x === null ? "n/d" : x.toFixed(d));
  let m = "# Backtest cieco " + r.anno + "\n\nTitoli usati: " + r.titoli + ". Il modello vede solo i dati precedenti a ogni data. Limiti: titoli falliti assenti; nessun dato di gruppo.\n\n";
  for (const k of NOMI) {
    const o = r.orizzonti[k];
    m += "## " + k + "\n| Verdetto | Casi | Saliti % | Rendimento mediano % |\n|---|---|---|---|\n";
    for (const v of ["favorevole", "neutro", "sfavorevole", "tutti"]) m += "| " + v + " | " + o[v].n + " | " + f(o[v].saliti) + " | " + f(o[v].mediana, 1) + " |\n";
    const fa = o.favorevole, tu = o.tutti;
    m += "\nEsito: " + (fa.n < 30 ? "troppo pochi casi favorevoli per concludere." : fa.saliti > tu.saliti && fa.mediana > tu.mediana ? "i «favorevole» hanno fatto meglio del solito." : "i «favorevole» NON hanno fatto meglio del solito in questo periodo.") + "\n\n";
  }
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { CATALOGO_TICKER } = await import("../supabase/functions/_shared/catalogo_tickers.ts");
  const chiave = process.env.TWELVEDATA_API_KEY; if (!chiave) { console.error("Manca TWELVEDATA_API_KEY"); process.exit(2); }
  const anno = Number(process.argv[2] || 2022);
  const barreDi = async (t) => {
    await new Promise((r) => setTimeout(r, 7700)); // piano gratuito: 8 richieste al minuto
    const r = await fetch("https://api.twelvedata.com/time_series?symbol=" + encodeURIComponent(t) + "&interval=1day&outputsize=5000&adjust=all&apikey=" + chiave);
    const j = await r.json(); if (!j.values) return null;
    return j.values.map((v) => ({ d: v.datetime, o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +v.volume || 0 }));
  };
  const r = await backtestCieco(barreDi, CATALOGO_TICKER.slice(0, Number(process.env.MAX_TITOLI || 60)), { anno });
  const testo = rapporto(r); writeFileSync("backtest_cieco.md", testo); console.log(testo);
}
