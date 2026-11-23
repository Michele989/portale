import assert from "node:assert/strict";
import { aggiornaRegistro } from "../supabase/functions/_shared/registro_segnali.ts";
import { salvaPrevisioni, valutaPrevisioni } from "../supabase/functions/_shared/registro_previsioni.ts";
import { serieStati, mulberry32 } from "../supabase/functions/_shared/previsioni.ts";

function serie(n, s) {
  const rnd = mulberry32(s); const g = () => { let x = 0; for (let i = 0; i < 6; i++) x += rnd(); return (x - 3) / 0.7071; };
  let p = 100, mu = 0; const out = []; const d0 = Date.UTC(2016, 0, 4);
  for (let i = 0; i < n; i++) { mu = 0.98 * mu + 0.001 * g(); const o = p * (1 + 0.001 * g()); p *= 1 + 0.0003 + mu + 0.012 * g(); out.push({ d: new Date(d0 + i * 864e5).toISOString().slice(0, 10), o, h: Math.max(o, p) * 1.003, l: Math.min(o, p) * 0.997, c: p, v: 1e6 * (0.7 + rnd()) }); }
  return out;
}
// finto client: registra scritture, restituisce righe preparate
function finto(aperte = [], segnaliAperti = []) {
  const log = { upsert: [], rpc: [] };
  const catena = (tab) => ({ select: () => ({ eq: () => ({ is: async () => ({ data: tab === "segnali" ? segnaliAperti : [] }) }) }), upsert: async (rows, o) => { log.upsert.push({ tab, rows: [].concat(rows), o }); return { error: null }; }, update: () => ({ eq: async () => ({}) }) });
  return { log, from: catena, rpc: async (n, a) => { log.rpc.push(n); return { data: aperte }; } };
}
const rec = serie(1500, 21).reverse(); // dal piu' recente
const cron = rec.slice().reverse();
const stati = serieStati(cron);
// trovo un giorno di "ingresso nello stato forte" e uno di permanenza
let ingresso = -1, permanenza = -1;
for (let i = 300; i < cron.length; i++) { if (stati[i] === "forte" && stati[i - 1] !== "forte" && ingresso < 0) ingresso = i; if (stati[i] === "forte" && stati[i - 1] === "forte" && permanenza < 0) permanenza = i; }
assert.ok(ingresso > 0 && permanenza > 0);
const upSegnali = (sb) => sb.log.upsert.filter((u) => u.tab === "segnali");
let sb = finto(); await aggiornaRegistro(sb, "TST", cron.slice(0, ingresso + 1).reverse(), false);
assert.equal(upSegnali(sb).length, 1, "primo giorno nello stato: segnale registrato"); assert.equal(upSegnali(sb)[0].rows[0].data_segnale, cron[ingresso].d); assert.equal(upSegnali(sb)[0].rows[0].tipo, "trend");
sb = finto(); await aggiornaRegistro(sb, "TST", cron.slice(0, permanenza + 1).reverse(), false);
assert.equal(upSegnali(sb).length, 0, "se il titolo era gia' nello stato il giorno prima: nessun nuovo segnale");
sb = finto(); await aggiornaRegistro(sb, "TST", cron.slice(0, ingresso + 1).reverse(), true);
assert.equal(sb.log.upsert.length, 0, "dati dubbi: non si registra nulla");
console.log("ok registro segnali");

// previsioni: scrittura immutabile (ignoreDuplicates) e valutazione
sb = finto(); const n1 = await salvaPrevisioni(sb, "TST", rec);
const up = sb.log.upsert[0]; assert.equal(up.tab, "previsioni"); assert.equal(up.o.ignoreDuplicates, true); assert.equal(up.o.onConflict, "ticker,data_prev,orizzonte,modello,versione");
assert.equal(n1, up.rows.length); assert.ok(n1 >= 6); assert.ok(up.rows.every((r) => r.data_prev === rec[0].d && r.prob_su >= 0 && r.prob_su <= 1));
const T = 1000;
sb = finto([{ id: 1, data_prev: cron[T].d, orizzonte: 21 }, { id: 2, data_prev: cron[T].d, orizzonte: 63 }, { id: 3, data_prev: cron[cron.length - 3].d, orizzonte: 21 }]);
const m = await valutaPrevisioni(sb, "TST", rec);
assert.equal(m, 2, "due maturate, una no");
const es = sb.log.upsert.find((u) => u.tab === "previsioni_esiti").rows;
assert.deepEqual(es.map((r) => r.previsione_id), [1, 2]); assert.equal(es[0].data_ingresso, cron[T + 1].d); assert.equal(es[0].su_apertura, true);
assert.equal(sb.log.upsert.find((u) => u.tab === "previsioni_esiti").o.ignoreDuplicates, true);
console.log("test_registri OK");
