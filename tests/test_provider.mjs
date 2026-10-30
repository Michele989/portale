import assert from "node:assert/strict";
import * as P from "../supabase/functions/_shared/provider.ts";
import { ErroreServizio } from "../supabase/functions/_shared/dati.ts";
import * as O from "../supabase/functions/_shared/orizzonti.ts";
import { elaboraVerdetti } from "../supabase/functions/_shared/registro_verdetti.ts";
import { eseguiPrecarica } from "../supabase/functions/_shared/precarica.ts";

// retry: solo errori temporanei, con attesa crescente
{
  const attese = []; let n = 0;
  const r = await P.conRetry(async () => { n++; if (n < 3) throw new ErroreServizio(502, "ERRORE_DATI", "x"); return "ok"; }, { attendi: async (ms) => attese.push(ms), baseMs: 100 });
  assert.equal(r, "ok"); assert.deepEqual(attese, [100, 200]);
  let m = 0;
  await assert.rejects(P.conRetry(async () => { m++; throw new ErroreServizio(429, "LIMITE_MINUTO", "x"); }, { attendi: async () => {} }), (e) => e.codice === "LIMITE_MINUTO");
  assert.equal(m, 1, "i limiti non si riprovano");
  let k = 0;
  await assert.rejects(P.conRetry(async () => { k++; throw new ErroreServizio(502, "ERRORE_DATI", "x"); }, { attendi: async () => {}, tentativi: 3 }));
  assert.equal(k, 3, "al massimo 3 tentativi");
}
// confronto fra fonti
{
  const A = [{ d: "2026-10-28", c: 100, h: 101, l: 99, v: 1 }, { d: "2026-10-27", c: 98, h: 99, l: 97, v: 1 }];
  assert.equal(P.confrontaFonti(A, [{ d: "2026-10-28", c: 100.5, h: 1, l: 1, v: 1 }]), "ok");
  assert.equal(P.confrontaFonti(A, [{ d: "2026-10-28", c: 110, h: 1, l: 1, v: 1 }]), "incerto");
  assert.equal(P.confrontaFonti(A, null), "non_disponibile");
  assert.equal(P.confrontaFonti(A, [{ d: "2020-01-01", c: 1, h: 1, l: 1, v: 1 }]), "non_disponibile");
  const csv = "Date,Open,High,Low,Close,Volume\n2026-10-27,97,99,96,98,1000\n2026-10-28,99,101,98,100,2000\n";
  const b = P.leggiCsvStooq(csv); assert.equal(b[0].d, "2026-10-28"); assert.equal(b[0].c, 100);
  assert.equal(P.leggiCsvStooq("No data"), null);
  assert.equal(P.simboloStooq("AAPL"), "aapl.us"); assert.equal(P.simboloStooq("ENI.MI"), null);
  const f = P.stooq(async () => ({ ok: true, text: async () => csv }));
  assert.equal((await f.serie("AAPL"))[0].c, 100);
  assert.equal(await P.stooq(async () => { throw new Error("rete"); }).serie("AAPL"), null, "rete assente: nessun errore");
}
// mercato debole
{
  const su = Array.from({ length: 250 }, (_, i) => ({ d: "x", c: 200 - i * 0.1, h: 0, l: 0, v: 0 })); // piu' recente per prima, in salita
  const giu = su.slice().reverse().map((x, i) => ({ ...x, c: 100 + i }));
  assert.equal(P.mercatoDebole(su), false); assert.equal(P.mercatoDebole(giu.reverse().map((x, i) => ({ ...x, c: 100 + i * 0.1 }))), true);
  assert.equal(P.mercatoDebole(null), false);
}
// declassamento
{
  function reg(n, seed, blocco = 120) { let s = seed, p = 100; const cron = []; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let i = 0; i < n; i++) { const up = Math.floor(i / blocco) % 2 === 0; const c = p * (1 + (rnd() - 0.5) * 0.02 + (up ? 0.0035 : -0.0015)); cron.push({ d: new Date(2019, 0, 1 + i).toISOString().slice(0, 10), h: c * 1.004, l: c * 0.996, c, v: 1e6 }); p = c; } return cron; }
  const st = O.analizzaOrizzonti(reg(1300, 7), { senzaVentaglio: true });
  assert.equal(st.breve.verdetto, "favorevole");
  const d = O.applicaDeclassamenti(st, [{ modello: "trend", orizzonte: "breve" }]);
  assert.equal(d.breve.verdetto, "neutro"); assert.ok(d.breve.punteggio100 <= 39); assert.ok(["bassa", "insufficiente"].includes(d.breve.affidabilita));
  // registro: nuovi campi
  const rec = reg(1300, 7).reverse(); // piu' recente per prima
  rec[0].d = "2026-10-28"; // la data non conta qui
  const { nuovi } = elaboraVerdetti("TEST", rec.map((b, i) => ({ ...b, d: new Date(Date.UTC(2026, 9, 28 - i)).toISOString().slice(0, 10) })), [], new Date("2026-10-29T10:00:00Z"));
  for (const r of nuovi) { assert.ok(r.versione === O.VERSIONE_MODELLO && ["trend", "rimbalzo"].includes(r.modello)); assert.ok(r.punteggio100 >= 0 && r.punteggio100 <= 100); assert.ok(r.prob_dichiarata === null || (r.prob_dichiarata >= 0 && r.prob_dichiarata <= 100)); }
  assert.ok(nuovi.length >= 1);
}
// precarica: contatori ed elenco errori
{
  const r = await eseguiPrecarica({
    daAggiornare: async () => ["A", "B", "C"],
    scarica: async (t) => { if (t === "B") throw new ErroreServizio(404, "TICKER_NON_TROVATO", "x"); if (t === "C") throw new ErroreServizio(502, "ERRORE_DATI", "x"); return []; },
    dopo: async () => ({ incerti: true }), segnaErrore: async () => {}, attendi: async () => {}, adesso: () => 0,
  }, { massimo: 3, pausaMs: 0, durataMaxMs: 1e9 });
  assert.equal(r.scaricati, 1); assert.equal(r.errori, 2); assert.equal(r.incerti, 1); assert.deepEqual(r.elenco_errori, ["B: TICKER_NON_TROVATO", "C: ERRORE_DATI"]);
}
console.log("test_provider OK");
import * as S from "../supabase/functions/_shared/sorveglianza.ts";
assert.equal(S.jobInRitardo(null, new Date("2026-10-28T08:00:00Z")), true);
assert.equal(S.jobInRitardo("2026-10-27T23:00:00Z", new Date("2026-10-28T08:00:00Z")), false);
assert.equal(S.jobInRitardo("2026-10-26T01:00:00Z", new Date("2026-10-28T08:00:00Z")), true);
assert.equal(S.jobInRitardo(null, new Date("2026-10-31T08:00:00Z")), false, "weekend");
const t = S.testoReport([{ modello: "trend", orizzonte: "breve", versione: "2.0", n: 50, fav_n: 20, fav_dichiarato: 62, fav_osservato: 58, base: 55, vantaggio: 3, brier: 0.24 }], "2026-09", []);
assert.match(t.testo, /trend breve \(v2.0\): 50 casi/); assert.match(t.testo, /Nessun modello declassato/);
console.log("sorveglianza OK");
