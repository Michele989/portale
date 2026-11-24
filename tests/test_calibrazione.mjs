import assert from "node:assert/strict";
import { fitCalibrazione, applicaCalibrazione, ricalibrazione, brier } from "../supabase/functions/_shared/calibrazione.ts";
import { mulberry32 } from "../supabase/functions/_shared/previsioni.ts";
const rnd = mulberry32(8);
const sig = (x) => 1 / (1 + Math.exp(-x)), lg = (p) => Math.log(p / (1 - p));
function dati(n, k) { // probabilita' vera p; dichiarata troppo estrema con fattore k
  const out = [];
  for (let i = 0; i < n; i++) { const pv = 0.25 + 0.5 * rnd(); const y = rnd() < pv ? 1 : 0; const dich = sig(k * lg(pv)); out.push({ p: dich, y, data: "2026-" + String(1 + Math.floor(i / 400)).padStart(2, "0") + "-" + String(1 + (i % 28)).padStart(2, "0") }); }
  return out;
}
// 1) troppo sicuri (k = 2): la pendenza stimata e' circa 0,5 e la ricalibrazione migliora fuori campione
const sbagliati = dati(6000, 2);
const c = fitCalibrazione(sbagliati.map((x) => x.p), sbagliati.map((x) => x.y));
assert.ok(c.b > 0.4 && c.b < 0.65, "b = " + c.b); assert.ok(Math.abs(c.a) < 0.15);
const r = ricalibrazione(sbagliati); assert.equal(r.attiva, true, r.nota); assert.ok(r.brierDopoFuoriCampione < r.brierPrima);
assert.ok(Math.abs(applicaCalibrazione(0.9, r) - 0.9) > 0.1, "la correzione sposta davvero la probabilita'");
// 2) gia' calibrati: nessuna correzione
const buoni = dati(6000, 1); const r2 = ricalibrazione(buoni); assert.equal(r2.attiva, false, r2.nota);
const cb = fitCalibrazione(buoni.map((x) => x.p), buoni.map((x) => x.y)); assert.ok(Math.abs(cb.b - 1) < 0.15 && Math.abs(cb.a) < 0.1, "b " + cb.b + " a " + cb.a);
// 3) pochi dati: niente
assert.equal(ricalibrazione(dati(100, 2)).attiva, false); assert.match(ricalibrazione(dati(100, 2)).nota, /insufficiente/);
assert.equal(fitCalibrazione([0.5], [1]), null);
// 4) tutte uguali (nessuna informazione): stabile, nessun errore
const piatti = Array.from({ length: 500 }, (_, i) => ({ p: 0.6, y: i % 5 < 3 ? 1 : 0, data: "2026-03-" + String(1 + (i % 28)).padStart(2, "0") }));
const cp = fitCalibrazione(piatti.map((x) => x.p), piatti.map((x) => x.y)); assert.ok(cp && isFinite(cp.a) && isFinite(cp.b));
assert.ok(brier([0.5, 0.5], [1, 0]) === 0.25);
console.log("test_calibrazione OK", c.b.toFixed(2));
