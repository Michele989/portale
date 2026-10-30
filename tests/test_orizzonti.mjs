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
// FASE 3: in un rialzo costante OGNI periodo sale: nessun vantaggio sul "solito" -> mai favorevole
assert.notEqual(su.medio.verdetto, "favorevole", "rialzo costante: nessun vantaggio sul solito");
assert.ok(su.medio.punteggio100 >= 0 && su.medio.punteggio100 <= 100);
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
  assert.ok(contr.length >= 3 && contr.length <= 15, "profili presenti: " + contr.length);
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
    if (base[k].affidabilita === "bassa" && conBuono[k].oos.esito === "conferma" && conBuono[k].fragile !== true) assert.equal(conBuono[k].affidabilita, "media", k + ": il gruppo alza da bassa a media");
    assert.notEqual(conBuono[k].affidabilita, "alta", k + ": il gruppo non porta mai ad alta");
  }
  // campione di gruppo troppo piccolo: nessuna conferma e nessun effetto
  const piccolo = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, gruppo: { medio: { titoli: 3, n: 30, indip: 5, pos: 3, hist: gruppoBuono.hist } } });
  assert.equal(piccolo.medio.confermaGruppo, null); assert.equal(piccolo.medio.verdetto, base.medio.verdetto); assert.equal(piccolo.medio.affidabilita, base.medio.affidabilita);
  // dati con anomalie: nessun rafforzamento
  const anom = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, datiOk: false, gruppo: { breve: gruppoBuono } });
  assert.ok(["bassa", "insufficiente"].includes(anom.breve.affidabilita));
}
// probabilita' di un rialzo minimo: tabelle di percentili coerenti
for (const k of ["breve", "medio", "lungo"]) {
  const t = su[k].storico.tutti;
  assert.equal(t.pct.length, 101); assert.equal(t.pctMax.length, 101);
  for (let q = 1; q <= 100; q++) { assert.ok(t.pct[q] >= t.pct[q - 1], "pct crescente"); assert.ok(t.pctMax[q] >= t.pctMax[q - 1], "pctMax crescente"); }
  for (let q = 0; q <= 100; q++) assert.ok(t.pctMax[q] >= t.pct[q] - 0.2, "il massimo toccato non e' mai sotto il rendimento finale");
  assert.ok(Math.abs(t.pct[50] - t.mediana) < 0.2, "il 50esimo percentile e' la mediana");
}
// registro notturno: niente calcolo dei massimi
assert.equal(O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true }).breve.storico.tutti.pct, undefined);
// ---- FASE 1: affidabilita' "alta" severa
assert.equal(O.livello(3, 10), "insufficiente");
assert.equal(O.livello(10, 10), "bassa");
assert.equal(O.livello(50, 10), "media");
assert.equal(O.livello(200, 20), "media", "intervallo largo: mai alta");
assert.equal(O.livello(200, 14), "alta");
assert.equal(O.livello(79, 5), "media", "servono 80 periodi");
assert.ok(O.ampiezzaWilson(50, 100) > 18 && O.ampiezzaWilson(50, 100) < 21, "ampiezza Wilson n=100: " + O.ampiezzaWilson(50, 100));
assert.ok(O.ampiezzaWilson(50, 200) < 15 && O.ampiezzaWilson(50, 150) > 15);
assert.equal(O.ampiezzaWilson(null, 10), null);
for (const k of ["breve", "medio", "lungo"]) {
  const o = su[k];
  assert.ok(o.affidabilita !== "alta" || (o.storico.tutti.indipendenti >= 80 && o.ampiezza95 <= 15), k + ": alta solo con 80 periodi e intervallo stretto");
}

// ---- FASE 1: due modelli. Un titolo in forte ribasso usa il modello "rimbalzo" (mai 0/4 da trend + "rimbalzo")
{
  const base = serie(1300, 31, 0.0006);
  let p = base[base.length - 1].c;
  const giu = [];
  for (let i = 0; i < 25; i++) { const c = p * 0.985; giu.push({ d: new Date(2025, 0, 1 + i).toISOString().slice(0, 10), h: p * 1.003, l: c * 0.997, c, v: 1e6 }); p = c; }
  const ser = base.concat(giu);
  const r = O.analizzaOrizzonti(ser, { senzaVentaglio: true });
  const oggi = O.profiliOggi(ser);
  for (const k of ["breve", "medio", "lungo"]) {
    assert.equal(r[k].modello, "rimbalzo", k + ": modello rimbalzo");
    assert.equal(oggi[k], O.PROFILO_RIMBALZO);
    assert.ok(r[k].criteri.some((c) => /Prezzo almeno 5% sotto/.test(c.t)) && !r[k].criteri.some((c) => /RSI tra 45 e 70/.test(c.t)), k + ": criteri propri del rimbalzo");
    assert.match(r[k].storico.profilo, /ribasso deciso/);
  }
  const contr = O.contributoProfili(ser);
  assert.ok(contr.some((x) => x.profilo === O.PROFILO_RIMBALZO), "il profilo rimbalzo alimenta il gruppo");
  // titolo in trend normale: modello trend
  const sano = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true });
  for (const k of ["breve", "medio", "lungo"]) assert.equal(sano[k].modello, "trend");
}

// ---- FASE 1: confronto con il gruppo coerente (titolo peggio / meglio / in linea)
{
  const mk = (pos, n) => { const hh = new Array(O.HIST_LEN).fill(0); hh[O.indiceHist(0.03)] = pos; hh[O.indiceHist(-0.02)] = n - pos; return { titoli: 40, n, indip: 400, pos, hist: hh }; };
  const ref = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true });
  const pT = ref.medio.storico[ref.medio.storico.usato === "simili" ? "simili" : "tutti"].pPositivi;
  const peggio = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, gruppo: { medio: mk(Math.round((pT + 15) * 10), 1000) } });
  assert.equal(peggio.medio.confrontoGruppo.esito, "peggio");
  const meglio = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, gruppo: { medio: mk(Math.max(1, Math.round((pT - 15) * 10)), 1000) } });
  assert.equal(meglio.medio.confrontoGruppo.esito, "meglio");
  const linea = O.analizzaOrizzonti(serie(1300, 11, 0.0012), { senzaVentaglio: true, gruppo: { medio: mk(Math.round(pT * 10), 1000) } });
  assert.equal(linea.medio.confrontoGruppo.esito, "in_linea");
  assert.equal(ref.medio.confrontoGruppo, null);
}
console.log("test_orizzonti OK", { medio: su.medio.verdetto, affid: su.medio.affidabilita, pPos: Math.round(su.medio.storico.tutti.pPositivi), indLungo: su.lungo.storico.tutti.indipendenti });

// ---------------------------------------------------------------- FASE 3
function regimi(n, seed, blocco = 120) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    const up = Math.floor(i / blocco) % 2 === 0;
    const r = (rnd() - 0.5) * 0.02 + (up ? 0.0035 : -0.0015);
    const c = p * (1 + r);
    cron.push({ d: new Date(2019, 0, 1 + i).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 });
    p = c;
  }
  return cron;
}
const mom = O.analizzaOrizzonti(regimi(1300, 7, 120), { senzaVentaglio: true });
const b = mom.breve;
assert.equal(b.verdetto, "favorevole", "con vero vantaggio sul solito -> favorevole");
assert.ok(b.vantaggio > 0 && b.vantaggioMin > b.base, "favorevole solo se limite inferiore > solito");
assert.equal(b.versione, O.VERSIONE_MODELLO);
assert.equal(b.oos.esito, "conferma");
assert.notEqual(b.affidabilita, "alta", "poche conferme: mai alta");
// scomposizione: la somma dei punti e' il punteggio (entro il tetto 0-100)
for (const k of ["breve", "medio", "lungo"]) {
  const o = mom[k];
  const somma = Math.round(Math.max(0, Math.min(100, o.scomposizione.reduce((a, x) => a + x.punti, 0))));
  if (o.verdetto !== "non_valutabile") assert.equal(o.punteggio100, somma, k + " scomposizione = punteggio");
  assert.ok(o.scomposizione.length >= 5);
}
// regime di mercato debole: il trend favorevole viene declassato
const reg = O.analizzaOrizzonti(regimi(1300, 7, 120), { senzaVentaglio: true, regimeSfavorevole: true });
assert.equal(reg.breve.verdetto, "neutro", "mercato debole declassa il trend");
assert.equal(reg.breve.regimeSfavorevole, true);
assert.ok(reg.breve.punteggio100 < b.punteggio100);
// trimestrale in arrivo: affidabilita' al massimo media + penalita'
const tr = O.analizzaOrizzonti(regimi(1300, 7, 120), { senzaVentaglio: true, trimestraleInArrivo: true });
assert.ok(["media", "bassa"].includes(tr.breve.affidabilita)); assert.ok(tr.breve.punteggio100 < b.punteggio100);
// dati incerti: affidabilita' bassa e punteggio non nei primi posti
const inc = O.analizzaOrizzonti(regimi(1300, 7, 120), { senzaVentaglio: true, datiIncerti: true });
assert.equal(inc.breve.affidabilita, "bassa"); assert.ok(inc.breve.punteggio100 <= 39); assert.equal(inc.breve.datiIncerti, true);
// costi e tasse
assert.equal(O.rendimentoNetto(10, 0.3, 26), (10 - 0.3) * 0.74);
assert.equal(O.rendimentoNetto(-5, 0.3, 26), -5.3);
assert.equal(O.rendimentoNetto(null), null);
assert.ok(b.netto.mediana < b.storico.simili.mediana, "netto < lordo");
// empirical Bayes: poche osservazioni -> si avvicina al gruppo; molte -> resta il dato
assert.ok(O.restringi(90, 4, 50) < 60); assert.ok(O.restringi(90, 400, 50) > 88);
// Wilson
assert.ok(O.wilsonBasso(60, 10) < O.wilsonBasso(60, 200)); assert.ok(O.wilsonBasso(60, 200) < 60);
// robustezza: serie corta -> non valutata
assert.equal(O.analizzaOrizzonti(serie(150, 3, 0.0005), { senzaVentaglio: true }).breve.fragile, null);
console.log("FASE 3 OK");
