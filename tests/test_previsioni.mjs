import assert from "node:assert/strict";
import { analizzaSerie, STANDARD } from "../supabase/functions/_shared/analisi.ts";
import { serieStati, rendFuturi, previsioniTitolo, esitoPrevisione, bootstrapBlocchi, probSimili, mulberry32, seme, quantile } from "../supabase/functions/_shared/previsioni.ts";

// serie sintetica riproducibile (dal piu' recente), con aperture
function serie(n, deriva = 0.0004, vol = 0.012, s = 1) {
  const rnd = mulberry32(s); const out = []; let p = 100;
  const g = () => { let x = 0; for (let i = 0; i < 6; i++) x += rnd(); return (x - 3) / 0.7071; };
  const d0 = Date.UTC(2015, 0, 5);
  for (let i = 0; i < n; i++) {
    const o = p * (1 + 0.002 * g());
    p = p * (1 + deriva + vol * g());
    const h = Math.max(o, p) * (1 + 0.004 * rnd()), l = Math.min(o, p) * (1 - 0.004 * rnd());
    out.push({ d: new Date(d0 + i * 864e5).toISOString().slice(0, 10), o, h, l, c: p, v: 1e6 * (0.7 + rnd()) });
  }
  return out.reverse();
}
const rec = serie(1800);
const cron = rec.slice().reverse();

// 1) stato: identico a quello di analizzaSerie su molti prefissi
let confrontati = 0;
const stati = serieStati(cron);
for (const n of [80, 120, 260, 500, 900, 1300, 1799, 1800]) {
  const a = analizzaSerie(cron.slice(0, n).reverse(), STANDARD, { oggi: new Date("2030-01-01T00:00:00Z") });
  assert.ok(a, "analisi n=" + n);
  assert.equal(stati[n - 1], a.stato, "stato n=" + n + " " + stati[n - 1] + " vs " + a.stato);
  confrontati++;
}
console.log("ok stato coincide con analizzaSerie su", confrontati, "prefissi");

// 2) rendimenti futuri: ingresso all'apertura di T+1, uscita chiusura T+h
const r21 = rendFuturi(cron, 21);
const t = 100;
assert.ok(Math.abs(r21[t] - (cron[t + 21].c / cron[t + 1].o - 1) * 100) < 1e-9);
assert.equal(r21[cron.length - 1], null); assert.equal(r21[cron.length - 21], null); assert.notEqual(r21[cron.length - 22], null);
// senza aperture: ripiega sulla chiusura di T+1 (mai quella di T)
const senzaO = cron.map(({ o, ...x }) => x);
assert.ok(Math.abs(rendFuturi(senzaO, 21)[t] - (cron[t + 21].c / cron[t + 1].c - 1) * 100) < 1e-9);
console.log("ok rendimenti futuri");

// 3) nessun dato futuro: le previsioni a T non cambiano se aggiungo giorni dopo T
const T = 1500;
const p1 = previsioniTitolo(cron.slice(0, T).reverse(), { ticker: "XYZ", sim: 500 });
const cron2 = cron.slice(0, T).concat(cron.slice(T, T + 100).map((b) => ({ ...b, c: b.c * 3, o: b.o * 3, h: b.h * 3, l: b.l * 3 })));
const p2 = previsioniTitolo(cron2.slice(0, T).reverse(), { ticker: "XYZ", sim: 500 });
assert.deepEqual(p1, p2);
assert.ok(p1.length >= 6);
for (const p of p1) {
  assert.ok(p.probSu >= 0 && p.probSu <= 1, "prob " + p.probSu);
  assert.ok(p.p05 <= p.mediana && p.mediana <= p.p95);
  assert.ok(p.probPerd10 <= p.probPerd5 + 1e-12 && p.probGuad10 <= p.probGuad5 + 1e-12);
}
const modelli = new Set(p1.map((p) => p.modello));
assert.ok(modelli.has("base") && modelli.has("bootstrap"));
console.log("ok niente dati futuri, probabilita' coerenti, modelli:", [...modelli].join(","));

// 4) riproducibilita' del bootstrap
const c = cron.map((x) => x.c);
assert.deepEqual(bootstrapBlocchi(c, 63, "a", 300), bootstrapBlocchi(c, 63, "a", 300));
assert.notDeepEqual(bootstrapBlocchi(c, 63, "a", 300), bootstrapBlocchi(c, 63, "b", 300));
assert.equal(bootstrapBlocchi(c.slice(-20), 63, "a", 100).length, 0);

// 5) storico corto: nessuna previsione a 252; troppo corto: nessuna
const corta = previsioniTitolo(serie(500), { sim: 200 });
assert.ok(corta.every((p) => p.orizzonte !== 252) && corta.some((p) => p.orizzonte === 21));
assert.deepEqual(previsioniTitolo(serie(100)), []);

// 6) esito: maturazione e ingresso
const dp = cron[1000].d;
const e = esitoPrevisione(rec, dp, 21);
assert.equal(e.data_ingresso, cron[1001].d); assert.equal(e.data_esito, cron[1021].d); assert.equal(e.su_apertura, true);
assert.ok(Math.abs(e.rendimento - (cron[1021].c / cron[1001].o - 1) * 100) < 1e-9);
assert.equal(esitoPrevisione(rec, cron[cron.length - 5].d, 21), null); // non ancora maturata
assert.equal(esitoPrevisione(rec, "1999-01-01", 21), null);

// 7) riduzione verso la base: con pochi casi pesa poco il condizionato
assert.ok(Math.abs(probSimili(0.9, 30, 0.5, 21) - 0.5) < 0.2);
assert.ok(Math.abs(probSimili(0.9, 5000, 0.5, 21) - 0.9) < 0.05);
assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
console.log("test_previsioni OK");
