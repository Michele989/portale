import assert from "node:assert/strict";
import * as O from "../supabase/functions/_shared/orizzonti.ts";

function serie(n, seed, drift, vol = 0.012) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    const r = (rnd() - 0.5) * 2 * vol + drift;
    const c = p * (1 + r);
    cron.push({ d: new Date(2021, 0, 1 + i).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 });
    p = c;
  }
  return cron;
}

// 1) rialzo costante: orizzonte medio favorevole, ventaglio coerente
const su = O.analizzaOrizzonti(serie(1300, 11, 0.0012));
for (const k of ["breve", "medio", "lungo"]) {
  const o = su[k];
  assert.equal(o.nome, k);
  assert.ok(o.punteggio >= 0 && o.punteggio <= 4);
  assert.equal(o.criteri.length, 4);
  assert.ok(o.storico.tutti.n > 100, k + " campioni");
  assert.ok(["favorevole", "neutro", "sfavorevole", "non_valutabile"].includes(o.verdetto));
  const v = o.ventaglio;
  assert.ok(v, k + " ventaglio");
  assert.equal(v.passi[0], 0); assert.equal(v.passi[v.passi.length - 1], o.giorni);
  assert.equal(v.p10.length, v.passi.length);
  assert.equal(v.p10[0], v.p50[0]); assert.equal(v.p50[0], v.p90[0]);
  for (let j = 0; j < v.p50.length; j++) assert.ok(v.p10[j] <= v.p50[j] + 1e-9 && v.p50[j] <= v.p90[j] + 1e-9, "percentili ordinati");
  for (const e of [v.esempi.basso, v.esempi.centrale, v.esempi.alto]) { assert.equal(e.length, v.passi.length); assert.equal(e[0], v.p50[0]); }
  assert.ok(v.esempi.basso[v.passi.length - 1] <= v.esempi.alto[v.passi.length - 1], "esempio basso <= alto");
  assert.ok(v.finale.p10 < v.finale.p90 && v.volAnnua > 0);
}
assert.equal(su.medio.verdetto, "favorevole", "rialzo costante -> medio favorevole");
assert.equal(su.medio.storico.tutti.pPositivi > 55, true);
assert.ok(su.breve.storico.tutti.indipendenti > 30, "breve: molti periodi indipendenti");
assert.ok(su.lungo.storico.tutti.indipendenti <= 5, "lungo: pochi periodi indipendenti");
assert.ok(["bassa", "insufficiente", "media"].includes(su.lungo.affidabilita));

// 2) ribasso costante: sfavorevole
const giu = O.analizzaOrizzonti(serie(1300, 12, -0.0010));
assert.equal(giu.medio.verdetto, "sfavorevole", "ribasso -> medio sfavorevole");
assert.equal(giu.lungo.verdetto === "favorevole", false);

// 3) deterministico
assert.deepEqual(O.analizzaOrizzonti(serie(900, 5, 0.0004)).breve.ventaglio, O.analizzaOrizzonti(serie(900, 5, 0.0004)).breve.ventaglio, "ventaglio deterministico");

// 4) storico corto: lungo non valutabile, nessun crash
const corto = O.analizzaOrizzonti(serie(150, 3, 0.0005));
assert.equal(corto.lungo.verdetto, "non_valutabile");
assert.ok(corto.lungo.affidabilita === "insufficiente", "storico corto: lungo insufficiente");
assert.ok(corto.breve.etichetta.length > 0);

// 5) dati con anomalie: affidabilita' al massimo "bassa"
const anomalo = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { datiOk: false });
assert.ok(["bassa", "insufficiente"].includes(anomalo.breve.affidabilita), "dati anomali -> affidabilita' bassa");

// 6) ventaglio: ampiezza cresce con l'orizzonte e senza tendenza il centro resta vicino al prezzo
const v1 = su.breve.ventaglio, v3 = su.lungo.ventaglio;
assert.ok(v3.finale.p90 - v3.finale.p10 > v1.finale.p90 - v1.finale.p10, "ventaglio piu' largo sul lungo");
assert.ok(Math.abs(v1.finale.p50) < 5, "centro vicino a zero");
console.log("test_orizzonti OK", { medio: su.medio.verdetto, affid: su.medio.affidabilita, pPos: Math.round(su.medio.storico.tutti.pPositivi), indLungo: su.lungo.storico.tutti.indipendenti });
