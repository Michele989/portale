import assert from "node:assert/strict";
import * as C from "../supabase/functions/_shared/confronti.ts";
import * as O from "../supabase/functions/_shared/orizzonti.ts";
import * as A from "../supabase/functions/_shared/analisi.ts";
import { elaboraVerdetti } from "../supabase/functions/_shared/registro_verdetti.ts";

function barre(n, seed, drift, vol = 0.012, vf = 1e6, inizio = 2019) { // dalla più recente
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) { const c = p * (1 + (rnd() - 0.5) * 2 * vol + drift); cron.push({ d: new Date(inizio, 0, 1 + i).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: vf }); p = c; }
  return cron.reverse();
}
function regimi(n, seed, blocco = 120) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) { const up = Math.floor(i / blocco) % 2 === 0; const c = p * (1 + (rnd() - 0.5) * 0.02 + (up ? 0.0035 : -0.0015)); cron.push({ d: new Date(2019, 0, 1 + i).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 }); p = c; }
  return cron;
}

// "comprare e tenere": un rialzo costante sale sempre; un ribasso costante mai
{
  const su = C.rendimentiTenere(barre(900, 1, 0.002, 0.0001)), giu = C.rendimentiTenere(barre(900, 1, -0.002, 0.0001));
  assert.equal(su.medio.pPositivi, 100); assert.ok(su.medio.mediana > 5);
  assert.equal(giu.medio.pPositivi, 0);
  assert.ok(su.lungo.n > 0 && C.rendimentiTenere(barre(100, 1, 0.001)).lungo.pPositivi === null, "serie corta: nessun confronto");
  assert.ok(su.breve.p10 <= su.breve.mediana && su.breve.mediana <= su.breve.p90);
}
// volatilità: un periodo calmo e poi una tempesta -> alta
{
  const calma = barre(800, 3, 0.0004, 0.003);
  assert.equal(C.volatilitaMercato(calma).alta, false);
  const cron = barre(800, 3, 0.0004, 0.003).reverse();
  for (let i = cron.length - 20; i < cron.length; i++) { const f = i % 2 ? 1.04 : 0.96; cron[i] = { ...cron[i], c: cron[i - 1].c * f, h: cron[i - 1].c * 1.05, l: cron[i - 1].c * 0.95 }; }
  const tempesta = C.volatilitaMercato(cron.reverse());
  assert.equal(tempesta.alta, true); assert.ok(tempesta.valore > 25 && tempesta.percentile >= 80);
  assert.equal(C.volatilitaMercato(barre(100, 1, 0)), null);
}
// liquidità
{
  assert.equal(C.liquidita(barre(200, 1, 0, 0.01, 1e6)).bassa, false);
  assert.equal(C.liquidita(barre(200, 1, 0, 0.01, 50)).bassa, true);
  const senzaVolume = C.liquidita(barre(200, 1, 0, 0.01, 0)); assert.equal(senzaVolume.bassa, false); assert.equal(senzaVolume.valore, null);
}
// effetto cambio: euro che si rafforza -> il guadagno in euro si riduce (effetto negativo)
{
  const euroSu = C.effettoCambio(barre(800, 5, 0.0005, 0.001));
  assert.equal(euroSu.coppia, "EUR/USD"); assert.ok(euroSu.orizzonti.medio.mediana < 0, "EUR/USD sale -> effetto negativo");
  assert.ok(euroSu.variazione12m < 0, "dollaro piu' debole");
  const euroGiu = C.effettoCambio(barre(800, 5, -0.0005, 0.001)); assert.ok(euroGiu.orizzonti.medio.mediana > 0 && euroGiu.variazione12m > 0);
  assert.ok(euroSu.orizzonti.lungo.p10 <= euroSu.orizzonti.lungo.mediana && euroSu.orizzonti.lungo.mediana <= euroSu.orizzonti.lungo.p90);
  assert.equal(C.effettoCambio(barre(100, 1, 0)), null);
}
// modello: confronto SPY, volatilita', liquidita', contrasto, falsi positivi
{
  const mom = regimi(1300, 7, 120);
  const spy = C.rendimentiTenere(barre(1300, 9, 0.0002, 0.01));
  const b = O.analizzaOrizzonti(mom, { senzaVentaglio: true, spy });
  for (const k of ["breve", "medio", "lungo"]) assert.ok(b[k].confrontoSpy && typeof b[k].confrontoSpy.mediana === "number");
  assert.equal(O.analizzaOrizzonti(mom, { senzaVentaglio: true }).breve.confrontoSpy, null, "senza SPY nessun confronto");
  const v = O.analizzaOrizzonti(mom, { senzaVentaglio: true, volatilitaAlta: true });
  assert.equal(v.breve.volatilitaAlta, true); assert.ok(["bassa", "media"].includes(v.breve.affidabilita)); assert.ok(v.breve.motivi.some((m) => /agitato/.test(m)));
  const l = O.analizzaOrizzonti(mom, { senzaVentaglio: true, liquiditaBassa: true });
  assert.equal(l.breve.liquiditaBassa, true); assert.equal(l.breve.affidabilita, "bassa");
  // falsi positivi: mai favorevole se il vantaggio non regge al 99%
  let provati = 0, filtrati = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const x = regimi(1300, seed, 60 + (seed % 5) * 30);
    const con = O.analizzaOrizzonti(x, { senzaVentaglio: true }), senza = O.analizzaOrizzonti(x, { senzaVentaglio: true, controlloFalsiPositivi: false });
    for (const k of ["breve", "medio", "lungo"]) {
      provati++;
      if (con[k].verdetto === "favorevole") assert.ok(con[k].vantaggioMin99 !== null && con[k].vantaggioMin99 > con[k].base, "favorevole solo se regge al 99%");
      if (senza[k].verdetto === "favorevole" && con[k].verdetto !== "favorevole" && !con[k].falsoPositivo === false) filtrati++;
      assert.ok(O.wilsonBasso(60, 100, 2.576) < O.wilsonBasso(60, 100, 1.96));
    }
  }
  console.log("falsi positivi: provati", provati, "filtrati", filtrati);
  // contrasto fra orizzonti: se c'e' un favorevole e uno sfavorevole il flag e' vero su tutti e tre
  const flags = new Set(["breve", "medio", "lungo"].map((k) => b[k].orizzontiInContrasto));
  assert.equal(flags.size, 1, "stesso valore su tutti gli orizzonti");
  const vs = ["breve", "medio", "lungo"].map((k) => b[k].verdetto);
  assert.equal([...flags][0], vs.includes("favorevole") && vs.includes("sfavorevole"));
}
// il registro notturno passa i nuovi controlli senza errori
{
  const r = elaboraVerdetti("ABC", barre(1300, 4, 0.0004), [], new Date("2026-10-29"), undefined, { volatilitaAlta: true });
  assert.ok(Array.isArray(r.nuovi));
}
// dati: prezzi fermi e prezzi nulli
{
  const ok = barre(300, 2, 0.001); const q0 = A.controllaDati(ok, new Date(ok[0].d + "T12:00:00Z"));
  assert.ok(!q0.avvisi.some((a) => /identico/.test(a)));
  const fermi = ok.map((b, i) => (i >= 20 && i < 32 ? { ...b, c: ok[20].c, h: ok[20].c, l: ok[20].c } : b));
  const q1 = A.controllaDati(fermi, new Date(ok[0].d + "T12:00:00Z")); assert.ok(q1.avvisi.some((a) => /identico per \d+ giorni/.test(a)));
  const zero = ok.map((b, i) => (i === 40 ? { ...b, c: 0 } : b));
  const q2 = A.controllaDati(zero, new Date(ok[0].d + "T12:00:00Z")); assert.equal(q2.gravi, true); assert.ok(q2.avvisi.some((a) => /nulli o negativi/.test(a)));
}
// statistiche standard: ora includono il riferimento "giorno qualsiasi"
{
  const st = A.statisticheStandard(barre(1000, 6, 0.0005));
  assert.ok(st.caso.n > 20 && st.caso.pct !== null && st.caso.attesa !== null);
}
console.log("test_confronti OK");
