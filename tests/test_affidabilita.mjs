import assert from "node:assert/strict";
import * as A from "../supabase/functions/_shared/analisi.ts";

function serie(n, seed, drift = 0.0004, vol = 0.03) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    const c = p * (1 + (rnd() - 0.5) * vol + drift);
    cron.push({ d: new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10), h: Math.max(p, c) * 1.005, l: Math.min(p, c) * 0.995, c, v: 1e6 * (0.8 + rnd()) });
    p = c;
  }
  return cron; // cronologico
}
const rec = (cron) => cron.slice().reverse();

// --- simula: regole di uscita ---
function piatto(n) { return Array.from({ length: n }, (_, i) => ({ d: new Date(Date.UTC(2022, 0, 1 + i)).toISOString().slice(0, 10), h: 100, l: 100, c: 100, v: 1 })); }
const O = { tp: 8, sl: 8, comm: 0.2, spread: 0 };
let b = piatto(120); b[61] = { ...b[61], h: 109, l: 99 };
let ops = A.simula(b, (i) => i === 60, O);
assert.equal(ops.length, 1); assert.equal(ops[0].esito, "v"); assert.equal(ops[0].ret, 8);
b = piatto(120); b[61] = { ...b[61], h: 110, l: 91 };
ops = A.simula(b, (i) => i === 60, O);
assert.equal(ops[0].esito, "p", "stesso giorno => perdita prudente");
assert.ok(Math.abs(ops[0].ret - (-8 - 0.4)) < 1e-9);
b = piatto(120);
ops = A.simula(b, (i) => i === 60, O);
assert.equal(ops[0].esito, "s"); assert.equal(ops[0].giorni, 40);
assert.equal(A.simula(piatto(80), (i) => i === 60, O).length, 0, "non risolta a fine dati: non conteggiata");
// spread alza il target
b = piatto(120); b[61] = { ...b[61], h: 108.6, l: 99 };
assert.equal(A.simula(b, (i) => i === 60, { ...O, spread: 0 })[0].esito, "v");
assert.notEqual(A.simula(b, (i) => i === 60, { ...O, spread: 1 })[0].esito, "v");

// --- statOps: drawdown e composto ---
const st = A.statOps([{ i: 1, fine: 2, esito: "v", ret: 10, giorni: 1 }, { i: 3, fine: 4, esito: "p", ret: -20, giorni: 1 }], 10);
assert.ok(Math.abs(st.composto - (1.1 * 0.8 - 1) * 100) < 1e-9); assert.ok(Math.abs(st.maxDD - 20) < 1e-9);
assert.equal(st.pct, 50); assert.equal(st.tempoInvestito, 20);

// --- qualita' dati ---
const base = rec(serie(300, 3));
const oggi = new Date(base[0].d + "T12:00:00Z");
assert.equal(A.controllaDati(base, oggi).ok, true);
assert.ok(A.controllaDati(base, new Date(oggi.getTime() + 8 * 864e5)).avvisi.some((x) => /giorni fa/.test(x)));
assert.equal(A.controllaDati(base, new Date(oggi.getTime() + 20 * 864e5)).gravi, true);
const salto = base.map((x) => ({ ...x })); salto[100].c *= 0.4; salto[100].h *= 0.4; salto[100].l *= 0.4;
assert.equal(A.controllaDati(salto, oggi).gravi, true);
const buco = base.filter((_, i) => i < 100 || i > 130); assert.ok(A.controllaDati(buco, oggi).avvisi.some((x) => /buc/.test(x)));
const dup = base.slice(); dup[5] = { ...dup[4] }; assert.equal(A.controllaDati(dup, oggi).gravi, true);

// --- mercato ---
assert.equal(A.statoMercato(rec(serie(300, 5, 0.003, 0.01))).sopraSma200, true);
assert.equal(A.statoMercato(rec(serie(300, 5, -0.003, 0.01))).sopraSma200, false);
assert.equal(A.statoMercato(rec(serie(100, 5))), null);

// --- valuta / caso / fuori campione ---
const cron = serie(1300, 11);
const v1 = A.valuta(cron, "trend", O), v2 = A.valuta(cron, "trend", O);
assert.deepEqual(v1.vsCaso, v2.vsCaso, "confronto col caso deterministico");
assert.equal(v1.prima.n + v1.oos.n, v1.n);
assert.ok(v1.anni.every((a) => a.n >= 3) && v1.anniPositivi <= v1.anniTotali);
assert.ok(["alta", "media", "bassa", "insufficiente"].includes(v1.affidabilita));
if (v1.vsCaso) assert.ok(v1.vsCaso.pValue > 0 && v1.vsCaso.pValue <= 1);
const poco = A.valuta(serie(150, 2), "trend", O); assert.equal(poco.affidabilita, "insufficiente");
const vSp = A.valuta(cron, "trend", { ...O, spread: 2 }); assert.ok(vSp.vinti <= v1.vinti + 1);
// un segnale "regalato" (sempre vincente) batte il caso
const rialzo = serie(1300, 4, 0.0025, 0.016);
const forte = A.valuta(rialzo, "trend", O);
assert.ok(forte.pct > 70, "trend molto netto: " + forte.pct);

// --- valutaSegnale coerente con simula ---
const g = A.giorniSegnale(cron.map((x) => x.c), "trend");
const ops2 = A.simula(cron, (i) => g[i], A.STANDARD, true);
const primo = ops2[0];
const vs = A.valutaSegnale(rec(cron), cron[primo.i].d);
assert.equal(vs.esito, { v: "vinto", p: "perso", s: "scaduto" }[primo.esito]); assert.equal(vs.data_esito, cron[primo.fine].d);
assert.equal(A.valutaSegnale(rec(cron), cron[cron.length - 1].d), null, "segnale di oggi ancora aperto");
assert.equal(A.valutaSegnale(rec(cron), "1999-01-01"), null);

// --- statistiche standard ---
const ss = A.statisticheStandard(rec(cron)); assert.ok(ss.trend.n >= 0 && ss.ribasso.n >= 0);

// --- analisi completa ---
const d = rec(serie(1300, 21));
const an = A.analizzaSerie(d, { ...O, spread: 0.1 }, { oggi: new Date(d[0].d + "T12:00:00Z"), mercato: { ticker: "SPY", prezzo: 1, sma200: 2, distanza: -50, sopraSma200: false } });
assert.ok(an.buyHold && isFinite(an.buyHold.rendimento) && an.buyHold.maxDD >= 0);
assert.ok(Math.abs(an.targetPct - 8.5) < 1e-9, "target = tp + 2*comm + spread");
assert.equal(an.qualita.ok, true); assert.equal(an.giorniStorico, 1300);
assert.ok(Array.isArray(an.avvisi));
assert.ok(an.backtest.affidabilita && an.backtestRib.motivi.length > 0);
// avviso mercato solo se c'e' un segnale di acquisto
const conSegnale = A.analizzaSerie(rec(serie(1300, 4, 0.0025, 0.016)), O, { oggi: new Date("2100-01-01"), mercato: { ticker: "SPY", prezzo: 1, sma200: 2, distanza: -50, sopraSma200: false } });
// (data lontana => avviso dati vecchi, ma verifichiamo la presenza dell'avviso mercato quando stato e' forte/ipervenduto)
if (["forte", "ipervenduto"].includes(conSegnale.stato)) assert.ok(conSegnale.avvisi.some((x) => /Mercato generale/.test(x)));

// prestazioni: analisi completa su 1300 giorni
const t0 = Date.now(); A.analizzaSerie(d, O); const ms = Date.now() - t0;
assert.ok(ms < 1500, "analisi lenta: " + ms + "ms");
console.log("test_affidabilita OK (" + ms + " ms/analisi)", { pct: forte.pct, p: forte.vsCaso && forte.vsCaso.pValue, liv: forte.affidabilita });
