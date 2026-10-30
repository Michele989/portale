// Indicatori verificati contro valori noti o contro un calcolo indipendente.
import assert from "node:assert/strict";
import * as A from "../supabase/functions/_shared/analisi.ts";
const vicino = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, m + ": " + a + " vs " + b);

// --- media semplice
assert.equal(A.media([1, 2, 3, 4]), 2.5);

// --- RSI: primo valore del classico esempio StockCharts (14 giorni) = 70,53
const chiusure = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
// calcolo a mano: guadagni 3,34, perdite 1,40 -> RS 2,3857 -> RSI 70,46 (StockCharts mostra 70,53 perche' arrotonda i passaggi)
vicino(A.calcolaRSI(chiusure.slice().reverse(), 14), 100 - 100 / (1 + 3.34 / 1.40), 1e-9, "RSI calcolato a mano");
vicino(A.calcolaRSI(chiusure.slice().reverse(), 14), 70.53, 0.1, "RSI esempio StockCharts");
// RSI 100 se non ci sono cali, 0 se solo cali
assert.equal(A.calcolaRSI(Array.from({ length: 20 }, (_, i) => 100 - i), 14), 100, "solo rialzi (dal piu' recente: prezzi decrescenti all'indietro)");
vicino(A.calcolaRSI(Array.from({ length: 20 }, (_, i) => 100 + i), 14), 0, 1e-9, "solo ribassi");
assert.equal(A.calcolaRSI([1, 2, 3], 14), null, "serie troppo corta");
// RSI su serie piatta con un rialzo: gain/loss manuale
{ const c = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10]; // 7 rialzi +1, 7 ribassi -1 -> RS = 1 -> 50
  vicino(A.calcolaRSI(c.slice().reverse(), 14), 50, 1e-9, "RSI 50 con guadagni e perdite uguali"); }

// --- ATR (media semplice del true range a 14 giorni): serie con range costante e nessun gap = range
{ const n = 30, c = Array.from({ length: n }, () => 100), h = c.map((x) => x + 1), l = c.map((x) => x - 1);
  vicino(A.calcolaATR(h, l, c, 14), 2, 1e-9, "ATR = range costante");
  // con un gap: massimo vs chiusura precedente
  const c2 = c.slice(); const h2 = h.slice(), l2 = l.slice(); c2[0] = 100; h2[0] = 110; l2[0] = 100; // il piu' recente (indice 0) ha massimo 110
  vicino(A.calcolaATR(h2, l2, c2, 14), (10 + 13 * 2) / 14, 1e-9, "ATR con una barra larga"); }

// --- ADX: confronto con un calcolo indipendente (Wilder con somme, scritto qui in modo diverso)
function adxRif(h, l, c, p = 14) {
  const n = c.length, tr = [], pd = [], md = [];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
    const u = h[i] - h[i - 1], d = l[i - 1] - l[i];
    pd.push(u > d && u > 0 ? u : 0); md.push(d > u && d > 0 ? d : 0);
  }
  const sm = (a) => { const o = [a.slice(0, p).reduce((x, y) => x + y, 0)]; for (let i = p; i < a.length; i++) o.push(o[o.length - 1] * (1 - 1 / p) + a[i]); return o; };
  const T = sm(tr), P = sm(pd), M = sm(md);
  const dx = T.map((t, i) => { const a = 100 * P[i] / t, b = 100 * M[i] / t; return a + b ? 100 * Math.abs(a - b) / (a + b) : 0; });
  let adx = dx.slice(0, p).reduce((x, y) => x + y, 0) / p;
  for (let i = p; i < dx.length; i++) adx = (adx * (p - 1) + dx[i]) / p;
  return adx;
}
function genera(n, seed, drift) { let s = seed, p = 100; const h = [], l = [], c = []; const r = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) { const x = p * (1 + (r() - 0.5) * 0.03 + drift); h.push(Math.max(p, x) * 1.005); l.push(Math.min(p, x) * 0.995); c.push(x); p = x; } return { h, l, c }; }
for (const [seed, drift] of [[1, 0.004], [2, -0.004], [3, 0], [4, 0.0005]]) {
  const { h, l, c } = genera(200, seed, drift);
  const mio = A.calcolaADX(h.slice().reverse(), l.slice().reverse(), c.slice().reverse(), 14);
  vicino(mio, adxRif(h, l, c, 14), 1e-9, "ADX seed " + seed);
  assert.ok(mio >= 0 && mio <= 100);
}
// trend forte -> ADX alto; oscillazione -> basso
{ const t = genera(200, 9, 0.01), o = genera(200, 9, 0);
  const a1 = A.calcolaADX(t.h.slice().reverse(), t.l.slice().reverse(), t.c.slice().reverse()), a2 = A.calcolaADX(o.h.slice().reverse(), o.l.slice().reverse(), o.c.slice().reverse());
  assert.ok(a1 > 60 && a1 > a2, "ADX trend " + a1 + " vs laterale " + a2); }

// --- Intervallo di Wilson (valori di riferimento): 50/100 -> 40,4%-59,6%
{ const w = A.intervalloWilson95(50, 100); vicino(w.low, 40.38, 0.1, "Wilson basso"); vicino(w.high, 59.62, 0.1, "Wilson alto"); }
console.log("test_indicatori OK");
