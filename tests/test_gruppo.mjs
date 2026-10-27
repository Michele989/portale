import assert from "node:assert/strict";
import { gruppoDi, leggiGruppo, salvaContributo } from "../supabase/functions/_shared/gruppo.ts";
import { elaboraVerdetti } from "../supabase/functions/_shared/registro_verdetti.ts";
import * as O from "../supabase/functions/_shared/orizzonti.ts";

function serie(n, seed = 5, drift = 0.0006) {
  let s = seed, p = 100; const rec = []; const oggi = new Date("2026-10-20T00:00:00Z");
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const d = new Date(oggi); const out = [];
  for (let i = 0; i < n; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    const r = (rnd() - 0.5) * 0.024 + drift; const c = p * (1 + r);
    out.push({ d: d.toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 });
    p = c; d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse().reverse(); // dalla piu' recente? out e' dal presente al passato con prezzi in ordine inverso
}
// costruisco una serie coerente: prima in ordine cronologico, poi la inverto (come la cache: dal piu' recente)
function recenti(n, seed, drift) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const date = []; const d = new Date("2026-10-20T00:00:00Z");
  while (date.length < n) { if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) date.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  date.reverse();
  for (let i = 0; i < n; i++) { const r = (rnd() - 0.5) * 0.024 + drift; const c = p * (1 + r); cron.push({ d: date[i], h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 }); p = c; }
  return cron.reverse();
}

assert.equal(gruppoDi("SPY"), "etf"); assert.equal(gruppoDi("ARKK"), "crescita"); assert.equal(gruppoDi("AAPL"), "azioni"); assert.equal(gruppoDi("QUALSIASI"), "azioni");

// salvaContributo: solo catalogo, righe per orizzonte/profilo
let salvate = [];
const sbScrive = { from: (t) => ({ upsert: async (righe, opz) => { assert.equal(t, "profili_titolo"); assert.equal(opz.onConflict, "ticker,orizzonte,profilo"); salvate = righe; return { error: null }; } }) };
const rec = recenti(1500, 9, 0.0006);
assert.equal(await salvaContributo(sbScrive, "SPY", rec), true);
assert.ok(salvate.length >= 3 && salvate.every((r) => r.ticker === "SPY" && r.gruppo === "etf" && r.hist.length === O.HIST_LEN));
salvate = []; assert.equal(await salvaContributo(sbScrive, "ZZNONCAT", rec), false); assert.equal(salvate.length, 0, "fuori catalogo non alimenta il gruppo");
assert.equal(await salvaContributo({ from: () => ({ upsert: async () => ({ error: { message: "x" } }) }) }, "SPY", rec), false, "errore DB gestito");

// leggiGruppo: chiede il profilo di oggi per il gruppo giusto e traduce la risposta
let chiesto = null;
const sbLegge = { rpc: async (nome, arg) => { chiesto = { nome, arg }; return { data: arg.p_chiavi.map((k) => ({ o: k.o, p: k.p, titoli: 25, n: 500, indip: 120, pos: 300, hist: new Array(O.HIST_LEN).fill(1) })), error: null }; } };
const g = await leggiGruppo(sbLegge, "SPY", rec);
assert.equal(chiesto.nome, "studio_gruppo"); assert.equal(chiesto.arg.p_gruppo, "etf"); assert.equal(g.gruppo, "etf");
assert.ok(chiesto.arg.p_chiavi.length >= 1 && chiesto.arg.p_chiavi.every((k) => ["breve", "medio", "lungo"].includes(k.o) && Number.isInteger(k.p)));
assert.equal(g.dati.breve.titoli, 25); assert.equal(g.dati.breve.hist.length, O.HIST_LEN);
// risposta vuota / errore / eccezione: mai bloccare
assert.deepEqual((await leggiGruppo({ rpc: async () => ({ data: [], error: null }) }, "SPY", rec)).dati, {});
assert.deepEqual((await leggiGruppo({ rpc: async () => ({ data: null, error: { message: "x" } }) }, "SPY", rec)).dati, {});
assert.deepEqual((await leggiGruppo({ rpc: async () => { throw new Error("rete"); } }, "SPY", rec)).dati, {});
assert.deepEqual((await leggiGruppo({ rpc: async () => ({ data: [{ o: "breve", p: 1, titoli: 0, n: 0, indip: 0, pos: 0, hist: [] }], error: null }) }, "SPY", rec)).dati, {}, "gruppo vuoto ignorato");

// registro verdetti: con un gruppo che non conferma nessun "favorevole" viene registrato
const oggiD = new Date("2026-10-20T22:00:00Z");
const sbs = recenti(1500, 3, 0.0015);
const senza = elaboraVerdetti("AAA", sbs, [], oggiD);
const neg = (pos, n) => { const h = new Array(O.HIST_LEN).fill(0); h[O.indiceHist(-0.02)] = n - pos; h[O.indiceHist(0.02)] = pos; return { titoli: 40, n, indip: 400, pos, hist: h }; };
const con = elaboraVerdetti("AAA", sbs, [], oggiD, { breve: neg(40, 100), medio: neg(40, 100), lungo: neg(40, 100) });
assert.equal(con.nuovi.length, senza.nuovi.length);
assert.ok(con.nuovi.every((x) => x.verdetto !== "favorevole"), "gruppo contrario: nessun favorevole registrato");
console.log("test_gruppo OK");
