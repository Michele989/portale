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

// 7) dati di gruppo: contributo di un titolo, aggregazione, conferma e rafforzamento
{
  const ser = serie(1500, 21, 0.0008);
  const contr = O.contributoProfili(ser);
  assert.ok(contr.length >= 3 && contr.length <= 12, "profili presenti: " + contr.length);
  for (const r of contr) {
    assert.equal(r.hist.length, O.HIST_LEN); assert.equal(r.hist.reduce((a, b) => a + b, 0), r.n, "istogramma = casi");
    assert.ok(r.pos <= r.n && r.indip >= 1 && r.indip <= r.n);
  }
  // somma dei profili = tutti i casi con profilo calcolabile; il profilo di oggi esiste tra quelli contati
  const oggi = O.profiliOggi(ser);
  for (const k of ["breve", "medio", "lungo"]) {
    if (oggi[k] !== null) assert.ok(contr.some((r) => r.orizzonte === k && r.profilo === oggi[k]), "profilo di oggi nei contributi: " + k);
  }
  // indice istogramma e quantili
  assert.equal(O.indiceHist(-0.9), 0); assert.equal(O.indiceHist(5), O.HIST_LEN - 1); assert.equal(O.indiceHist(0), 51); assert.equal(O.indiceHist(0.0099), 51); assert.equal(O.indiceHist(0.01), 52);
  const h = new Array(O.HIST_LEN).fill(0); h[O.indiceHist(0.05)] = 100; h[O.indiceHist(-0.05)] = 100;
  const sg = O.statGruppo("ETF", { titoli: 20, n: 200, indip: 100, pos: 100, hist: h });
  assert.equal(sg.pPositivi, 50); assert.ok(Math.abs(sg.p90 - 5.5) < 0.6 && Math.abs(sg.p10 - (-4.5)) < 0.6, "quantili dall'istogramma: " + sg.p10 + " " + sg.p90);
  assert.equal(O.statGruppo("x", null), null);

  // gruppo che NON conferma: un verdetto favorevole diventa neutro
  const base = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true });
  assert.equal(base.medio.ventaglio, null, "senzaVentaglio");
  const gruppoNegativo = (pos, n) => { const hh = new Array(O.HIST_LEN).fill(0); hh[O.indiceHist(-0.02)] = n - pos; hh[O.indiceHist(0.02)] = pos; return { titoli: 40, n, indip: 400, pos, hist: hh }; };
  const conNeg = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, gruppo: { breve: gruppoNegativo(40, 100), medio: gruppoNegativo(40, 100), lungo: gruppoNegativo(40, 100) }, nomeGruppo: "ETF" });
  for (const k of ["breve", "medio", "lungo"]) {
    assert.equal(conNeg[k].confermaGruppo, false, k + " non confermato");
    assert.notEqual(conNeg[k].verdetto, "favorevole", k + ": mai favorevole se il gruppo non conferma");
    assert.equal(conNeg[k].gruppo.nome, "ETF");
  }
  if (base.medio.verdetto === "favorevole") { assert.equal(conNeg.medio.verdetto, "neutro"); assert.ok(conNeg.medio.motivi.some((m) => /gruppo.*non conferma/.test(m))); }
  // gruppo che conferma e campione ampio: affidabilita' sale di un livello (non oltre "alta")
  const gruppoBuono = { titoli: 40, n: 4000, indip: 600, pos: 2600, hist: (() => { const hh = new Array(O.HIST_LEN).fill(0); hh[O.indiceHist(0.03)] = 2600; hh[O.indiceHist(-0.02)] = 1400; return hh; })() };
  const conBuono = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, gruppo: { breve: gruppoBuono, medio: gruppoBuono, lungo: gruppoBuono } });
  const ord = { insufficiente: 0, bassa: 1, media: 2, alta: 3 };
  for (const k of ["breve", "medio", "lungo"]) {
    assert.equal(conBuono[k].confermaGruppo, true);
    assert.ok(ord[conBuono[k].affidabilita] >= ord[base[k].affidabilita], k + ": l'affidabilita' non scende");
    if (base[k].affidabilita === "bassa" || base[k].affidabilita === "media") assert.equal(ord[conBuono[k].affidabilita], ord[base[k].affidabilita] + 1, k + ": sale di un livello");
  }
  // campione di gruppo troppo piccolo: nessuna conferma e nessun effetto
  const piccolo = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, gruppo: { medio: { titoli: 3, n: 30, indip: 5, pos: 3, hist: gruppoBuono.hist } } });
  assert.equal(piccolo.medio.confermaGruppo, null); assert.equal(piccolo.medio.verdetto, base.medio.verdetto); assert.equal(piccolo.medio.affidabilita, base.medio.affidabilita);
  // dati con anomalie: nessun rafforzamento
  const anom = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, datiOk: false, gruppo: { breve: gruppoBuono } });
  assert.ok(["bassa", "insufficiente"].includes(anom.breve.affidabilita));
}
console.log("test_orizzonti OK", { medio: su.medio.verdetto, affid: su.medio.affidabilita, pPos: Math.round(su.medio.storico.tutti.pPositivi), indLungo: su.lungo.storico.tutti.indipendenti });
