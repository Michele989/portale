import assert from "node:assert/strict";
import { mulberry32 } from "../supabase/functions/_shared/previsioni.ts";
import { validazioneCompleta, holm, bootstrapRapporto } from "../supabase/functions/_shared/validazione.ts";

function universo(nTit, nGiorni, phi, seed) {
  const rnd = mulberry32(seed);
  const g = () => { let x = 0; for (let i = 0; i < 6; i++) x += rnd(); return (x - 3) / 0.7071; };
  const mercato = Array.from({ length: nGiorni }, () => 0.008 * g());
  const d0 = Date.UTC(2012, 0, 2);
  const serie = [];
  for (let k = 0; k < nTit; k++) {
    let p = 100, mu = 0; const cron = [];
    for (let i = 0; i < nGiorni; i++) {
      const e = 0.011 * g();
      mu = 0.98 * mu + phi * g(); // tendenza lenta che persiste (phi = forza); con phi = 0 niente tendenza
      const r = 0.0003 + mercato[i] + mu + e;
      const o = p * (1 + 0.001 * g()); p = p * (1 + r);
      cron.push({ d: new Date(d0 + i * 864e5).toISOString().slice(0, 10), o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 1e6 * (0.7 + rnd()) });
    }
    serie.push({ ticker: "T" + k, cron });
  }
  return serie;
}
// utilita'
assert.deepEqual(holm([0.01, 0.04, 0.03, null]), [0.03, 0.06, 0.06, null].map((x) => x));
{ const num = new Float64Array(200).fill(1), den = new Float64Array(200).fill(2); const b = bootstrapRapporto(num, den, 10, 100, mulberry32(1)); assert.equal(b.media, 0.5); assert.ok(b.campioni.every((x) => Math.abs(x - 0.5) < 1e-9)); }

// 1) nessun vantaggio vero: il metodo non deve inventarne uno
const nullo = universo(30, 1500, 0, 11);
const spy = universo(1, 1500, 0, 99)[0].cron;
const e0 = validazioneCompleta(nullo, spy, { B: 300, seed: "t0", orizzonti: [21, 63] });
assert.equal(e0.universo.titoli, 30);
for (const r of e0.regole) { assert.ok(r.media === null || Math.abs(r.media) < 1.5, "eccesso piccolo " + r.media); }
assert.ok(e0.regole.every((r) => r.pHolm === null || r.pHolm > 0.05), "nessun falso positivo dopo Holm: " + JSON.stringify(e0.regole.map((r) => r.pHolm)));
assert.match(e0.conclusione, /Nessun vantaggio dimostrabile/);
for (const p of e0.probabilita) { if (p.intero.bss !== null) assert.ok(p.intero.ci95[0] < 0.02, "BSS non significativo nel caso nullo"); }
console.log("ok caso nullo:", e0.conclusione.slice(0, 40), "| pHolm", e0.regole.map((r) => r.pHolm).join(","));

// 2) vantaggio vero (memoria nei rendimenti): "forte" deve risultare migliore del resto
const mom = universo(30, 1500, 0.0012, 12);
const e1 = validazioneCompleta(mom, spy, { B: 300, seed: "t1", orizzonti: [21] });
const forte = e1.regole.find((r) => r.regola === "forte");
assert.ok(forte.osservazioni > 1000);
assert.ok(forte.media > 0.1, "il vantaggio vero viene visto: " + forte.media);
assert.ok(forte.ci95[0] > 0, "intervallo sopra zero: " + forte.ci95);
console.log("ok vantaggio piantato visto: eccesso", forte.media, "% ci", forte.ci95, "pHolm", forte.pHolm);

// 3) dati futuri: cambiare il futuro non cambia le probabilita' stimate prima
const base = universo(8, 700, 0, 5);
const mod = base.map((s) => ({ ticker: s.ticker, cron: s.cron.map((b, i) => (i >= 600 ? { ...b, c: b.c * 2, o: b.o * 2, h: b.h * 2, l: b.l * 2 } : b)) }));
// uso solo la parte di stima: le probabilita' a date <= 500 dipendono da dati <= 500+h, quindi confronto tagliando
const t1 = validazioneCompleta(base.map((s) => ({ ticker: s.ticker, cron: s.cron.slice(0, 500) })), null, { B: 100, seed: "x", orizzonti: [21] });
const t2 = validazioneCompleta(mod.map((s) => ({ ticker: s.ticker, cron: s.cron.slice(0, 500) })), null, { B: 100, seed: "x", orizzonti: [21] });
assert.deepEqual(t1.probabilita[0].intero, t2.probabilita[0].intero);
console.log("test_validazione OK");

// ---- volatilita': GARCH utile quando la volatilita' cambia davvero nel tempo, non quando e' costante ----
function universoGarch(nTit, nGiorni, seed) {
  const rnd = mulberry32(seed); const g = () => { const u = Math.max(rnd(), 1e-12), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const d0 = Date.UTC(2010, 0, 4); const serie = [];
  for (let k = 0; k < nTit; k++) {
    let p = 100, s2 = 1.2e-4; const cron = [];
    for (let i = 0; i < nGiorni; i++) {
      const e = Math.sqrt(s2) * g(); const o = p; p *= 1 + 0.0003 + e; s2 = 4e-6 + 0.12 * e * e + 0.85 * s2;
      cron.push({ d: new Date(d0 + i * 864e5).toISOString().slice(0, 10), o, h: Math.max(o, p) * 1.002, l: Math.min(o, p) * 0.998, c: p, v: 1e6 });
    }
    serie.push({ ticker: "G" + k, cron });
  }
  return serie;
}
const eg = validazioneCompleta(universoGarch(12, 2600, 3), null, { B: 200, seed: "g", orizzonti: [21] });
assert.ok(eg.volatilita.previsioni > 100, "previsioni di volatilita': " + eg.volatilita.previsioni);
assert.equal(eg.volatilita.utile, true, "GARCH battuto non deve succedere se la volatilita' cambia: " + JSON.stringify(eg.volatilita.vantaggio_vs_ultimi63));
assert.match(eg.conclusioneRischio, /migliore dei confronti semplici/);
assert.equal(e0.volatilita.utile, false, "con volatilita' costante GARCH non e' dimostrato utile");
console.log("ok volatilita': utile con vol variabile (", JSON.stringify(eg.volatilita.vantaggio_vs_ultimi63.media), ") non con vol costante");
