import assert from "node:assert/strict";
import * as A from "../supabase/functions/_shared/analisi.ts";

// serie sintetica: random walk deterministico, dal piu' recente
function serie(n, seed = 1, drift = 0.0004) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    const r = (rnd() - 0.5) * 0.03 + drift; const c = p * (1 + r);
    cron.push({ d: new Date(2021, 0, 1 + i).toISOString().slice(0, 10), h: Math.max(p, c) * 1.005, l: Math.min(p, c) * 0.995, c, v: 1e6 * (0.8 + rnd()) });
    p = c;
  }
  return cron.reverse();
}

// Wilson
const w0 = A.intervalloWilson95(0, 20); assert.ok(w0.low === 0 && w0.high > 10, "wilson 0% ha margine");
const w1 = A.intervalloWilson95(20, 20); assert.ok(w1.high === 100 && w1.low < 90);
const w5 = A.intervalloWilson95(50, 100); assert.ok(Math.abs(w5.low - 40.4) < 0.5 && Math.abs(w5.high - 59.6) < 0.5);
assert.equal(A.intervalloWilson95(0, 0), null);

// RSI: serie sempre crescente -> 100; sempre calante -> 0
assert.equal(A.calcolaRSI(Array.from({ length: 30 }, (_, i) => 100 - i)), 100);
assert.equal(A.calcolaRSI(Array.from({ length: 30 }, (_, i) => 100 + i)), 0);
// ATR su barre costanti h-l=2, nessun gap
const hh = Array(30).fill(11), ll = Array(30).fill(9), cc = Array(30).fill(10);
assert.equal(A.calcolaATR(hh, ll, cc), 2);

// analisi completa
const b = serie(1300);
const r = A.analizzaSerie(b, { tp: 8, sl: 8, comm: 0.2 });
assert.ok(r && r.prezzo === b[0].c);
assert.ok(r.sma50 > 0 && r.rsi >= 0 && r.rsi <= 100 && r.atr14 > 0 && r.adx14 >= 0 && r.adx14 <= 100);
assert.ok(Math.abs(r.stopAtr - (r.prezzo - 2 * r.atr14)) < 1e-9);
assert.ok(Math.abs(r.targetPct - 8.4) < 1e-9);
assert.equal(r.serie.length, 90);
assert.ok(["ipervenduto", "forte", "neutro", "debole"].includes(r.stato));
for (const bt of [r.backtest, r.backtestRib]) {
  assert.equal(bt.n, bt.vinti + bt.persi + bt.scaduti);
  if (bt.n) { assert.ok(bt.low <= bt.pct && bt.pct <= bt.high); }
}
// non sovrapposti: n <= sovrapposti
const c = b.slice().reverse().map(x => x.c);
const ns = A.backtest(c, "trend", 8, 8, 0.2, true), so = A.backtest(c, "trend", 8, 8, 0.2, false);
assert.ok(ns.n <= so.n && ns.n > 0, `n ${ns.n} vs ${so.n}`);
// trend costante crescente: target sempre raggiunto
const salita = Array.from({ length: 300 }, (_, i) => 100 * Math.pow(1.01, i));
const bs = A.backtest(salita, "trend", 8, 8, 0.2, true);
assert.equal(bs.persi, 0);
// troppo poco storico
assert.equal(A.analizzaSerie(serie(40), { tp: 8, sl: 8, comm: 0.2 }), null);
// cache roundtrip
assert.deepEqual(A.espandi(A.comprimi(b)), b.map(x => ({ ...x })));
// Twelve Data parsing
const p = A.daTwelveData([{ datetime: "2026-10-08", high: "10", low: "9", close: "9.5", volume: "100" }, { datetime: "x", close: "abc" }, { datetime: "2026-10-07", high: "10", low: "9", close: "9.4" }]);
assert.equal(p.length, 2); assert.equal(p[1].v, 0);
assert.equal(A.limita("abc", 1, 5, 3), 3); assert.equal(A.limita(99, 1, 5, 3), 5);
// ---- FASE 1: solo barre chiuse (niente barra del giorno in corso)
{
  const mk = (d) => ({ d, h: 10, l: 9, c: 9.5, v: 1000 });
  const barre = [mk("2026-10-29"), mk("2026-10-28"), mk("2026-10-27")]; // dal piu' recente
  const t = (iso) => A.soloBarreChiuse(barre, new Date(iso)).map((b) => b.d);
  assert.deepEqual(t("2026-10-29T15:00:00Z"), ["2026-10-28", "2026-10-27"], "seduta in corso: barra scartata");
  assert.deepEqual(t("2026-10-29T20:00:00Z"), ["2026-10-28", "2026-10-27"], "16:00 a New York: ancora aperta/non definitiva");
  assert.deepEqual(t("2026-10-29T21:00:00Z"), ["2026-10-29", "2026-10-28", "2026-10-27"], "17:00 a New York: chiusa");
  assert.deepEqual(A.soloBarreChiuse([mk("2026-10-30"), mk("2026-10-29")], new Date("2026-10-31T12:00:00Z")).map((b) => b.d), ["2026-10-30", "2026-10-29"], "sabato: l'ultima seduta e' chiusa");
  assert.deepEqual(A.soloBarreChiuse(barre, new Date("2026-12-02T21:00:00Z")).map((b) => b.d), ["2026-10-29", "2026-10-28", "2026-10-27"], "date lontane: tutte chiuse");
  assert.deepEqual(A.soloBarreChiuse([mk("2026-12-02"), mk("2026-12-01")], new Date("2026-12-02T21:00:00Z")).map((b) => b.d), ["2026-12-01"], "ora solare: 16:00 a New York non e' ancora chiusa");
  assert.deepEqual(A.soloBarreChiuse([mk("2026-12-02"), mk("2026-12-01")], new Date("2026-12-02T22:00:00Z")).map((b) => b.d), ["2026-12-02", "2026-12-01"]);
  assert.deepEqual(A.soloBarreChiuse([mk("2026-11-05"), mk("2026-10-28")], new Date("2026-10-29T15:00:00Z")).map((b) => b.d), ["2026-10-28"], "barra futura scartata");
  assert.deepEqual(A.soloBarreChiuse([], new Date()), []);
}
console.log("test_analisi OK", { trend: ns, so: so.n, stato: r.stato });
