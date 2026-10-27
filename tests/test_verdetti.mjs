import assert from "node:assert/strict";
import { elaboraVerdetti, wilson, riepilogoVerdetti } from "../supabase/functions/_shared/registro_verdetti.ts";
// serie sintetica recente: 400 giorni lavorativi che finiscono oggi
const oggi = new Date("2026-10-20T22:00:00Z");
function serie(n, f = (i) => 100 + i * 0.1 + Math.sin(i / 5)) {
  const out = []; const d = new Date(oggi);
  for (let i = 0; i < n; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
    const c = f(n - 1 - i);
    out.push({ d: d.toISOString().slice(0, 10), h: c * 1.005, l: c * 0.995, c, v: 1e6 });
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out; // dal piu' recente
}
const rec = serie(1500);
let r = elaboraVerdetti("AAA", rec, [], oggi);
assert.equal(r.nuovi.length, 3); assert.deepEqual(r.nuovi.map((x) => x.orizzonte).sort(), ["breve", "lungo", "medio"]);
assert.ok(r.nuovi.every((x) => x.data_verdetto === rec[0].d && x.prezzo === rec[0].c && ["favorevole", "neutro", "sfavorevole"].includes(x.verdetto)));
assert.equal(r.chiusure.length, 0);
// chiusura: verdetto di 21 sedute fa -> rendimento reale
const cron = rec.slice().reverse(); const iv = cron.length - 1 - 21;
r = elaboraVerdetti("AAA", rec, [{ id: 7, orizzonte: "breve", data_verdetto: cron[iv].d }, { id: 8, orizzonte: "breve", data_verdetto: cron[iv + 1].d }, { id: 9, orizzonte: "medio", data_verdetto: cron[iv].d }], oggi);
assert.equal(r.chiusure.length, 1, "solo il breve del giorno giusto e' chiudibile");
assert.equal(r.chiusure[0].id, 7); assert.equal(r.chiusure[0].data_esito, cron[cron.length - 1].d);
assert.ok(Math.abs(r.chiusure[0].rendimento - (cron[cron.length - 1].c / cron[iv].c - 1) * 100) < 1e-9);
// data sconosciuta ignorata; pochi dati niente
assert.equal(elaboraVerdetti("AAA", rec, [{ id: 1, orizzonte: "breve", data_verdetto: "1999-01-01" }], oggi).chiusure.length, 0);
assert.equal(elaboraVerdetti("AAA", serie(30), [], oggi).nuovi.length, 0);
// dati vecchi (gravi): nessun nuovo verdetto, ma le chiusure restano possibili
const vecchi = rec.slice(0);
const tardi = new Date("2027-03-01T00:00:00Z");
r = elaboraVerdetti("AAA", vecchi, [{ id: 7, orizzonte: "breve", data_verdetto: cron[iv].d }], tardi);
assert.equal(r.nuovi.length, 0); assert.equal(r.chiusure.length, 1);
// Wilson e riepilogo
const w = wilson(50, 100); assert.ok(w[0] > 40 && w[0] < 41 && w[1] > 59 && w[1] < 60.5, w.join());
assert.equal(wilson(0, 0), null);
const rie = riepilogoVerdetti([
  { orizzonte: "breve", verdetto: "favorevole", n: 100, positivi: 62, rend_medio: 1.1 },
  { orizzonte: "breve", verdetto: "sfavorevole", n: 50, positivi: 30, rend_medio: 0.4 },
  { orizzonte: "breve", verdetto: "neutro", n: 50, positivi: 28, rend_medio: 0.5 },
], { breve: 12 });
const b = rie.find((x) => x.orizzonte === "breve");
assert.equal(b.chiusi, 200); assert.equal(b.aperti, 12); assert.equal(b.base_positivi, 60);
assert.equal(b.favorevole.azzeccati, 62); assert.equal(b.sfavorevole.azzeccati, 20); assert.equal(Math.round(b.sfavorevole.pct), 40);
assert.equal(rie.find((x) => x.orizzonte === "lungo").chiusi, 0);
console.log("test_verdetti OK");
