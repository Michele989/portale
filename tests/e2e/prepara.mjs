// Genera fixture.json: risultati di analisi veri (stesso codice del server) su serie sintetiche, per i test e2e.
import { writeFileSync } from "node:fs";
import * as A from "../../supabase/functions/_shared/analisi.ts";
import * as O from "../../supabase/functions/_shared/orizzonti.ts";
function serie(n, seed, drift, crollo = 0) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) { let r = (rnd() - 0.5) * 0.02 + drift; if (i >= n - 14) r = -crollo; const c = p * (1 + r);
    cron.push({ d: new Date(2022, 0, 1 + i).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 }); p = c; }
  return cron.reverse();
}
const out = {};
for (const t of ["SPY", "VOO", "QQQ", "ARKK", "GLD", "AAPL"]) {
  const bars = t === "ARKK" ? serie(900, 7, 0.0006, 0.012) : serie(900, t.charCodeAt(0) * 31 + t.length, 0.0005);
  const an = A.analizzaSerie(bars, { tp: 8, sl: 8, comm: 0.2, spread: 0.1 }, { oggi: new Date(bars[0].d + "T12:00:00Z") });
  out[t] = { ok: true, ticker: t, ...an, orizzonti: O.analizzaOrizzonti(bars.slice().reverse(), { datiOk: true }), dati_del: new Date().toISOString(), usi_risparmiati: 0 };
}
writeFileSync(new URL("./fixture.json", import.meta.url), JSON.stringify(out));
console.log("fixture:", Object.keys(out).join(","));
