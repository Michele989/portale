import assert from "node:assert/strict";
import { backtestCieco, rapporto } from "./backtest_cieco.mjs";
function serie(seed, drift) { // 2019-01-01 ... ~2023, dal piu' recente
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 2100; i++) { const c = p * (1 + (rnd() - 0.5) * 0.02 + drift); cron.push({ d: new Date(Date.UTC(2019, 0, 1 + i)).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 }); p = c; }
  return cron.reverse();
}
let chiamate = 0;
const r = await backtestCieco(async (t) => { chiamate++; return t === "VUOTO" ? null : t === "CORTO" ? serie(1, 0).slice(0, 200) : serie(t.charCodeAt(0), 0.0003); }, ["AAA", "BBB", "VUOTO", "CORTO"], { anno: 2022, passo: 42 });
assert.equal(chiamate, 4); assert.equal(r.titoli, 2, "salta i titoli senza dati o senza storico");
for (const k of ["breve", "medio", "lungo"]) {
  const o = r.orizzonti[k]; assert.ok(o.tutti.n > 10 || k === "lungo" && o.tutti.n > 0, k + ": casi " + o.tutti.n);
  assert.equal(o.favorevole.n + o.neutro.n + o.sfavorevole.n <= o.tutti.n, true);
}
const m = rapporto(r); assert.match(m, /Backtest cieco 2022/); assert.match(m, /Verdetto \| Casi/); assert.match(m, /Limiti: titoli falliti assenti/);
console.log("test_backtest_cieco OK");
