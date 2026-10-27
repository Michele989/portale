import assert from "node:assert/strict";
import { eseguiPrecarica } from "../supabase/functions/_shared/precarica.ts";
import { ErroreServizio } from "../supabase/functions/_shared/dati.ts";
function deps(lista, comportamento) {
  const st = { scaricati: [], errori: [], attese: 0, t: 0 };
  return { st, d: {
    daAggiornare: async (n) => lista.slice(0, n),
    scarica: async (t) => { const c = comportamento[t]; if (c) throw c; st.scaricati.push(t); },
    segnaErrore: async (t) => { st.errori.push(t); },
    attendi: async (ms) => { st.attese++; st.t += ms; },
    adesso: () => st.t,
  } };
}
const opz = { massimo: 12, pausaMs: 7700, durataMaxMs: 125000 };
let { st, d } = deps(["A", "B", "C"], {});
let r = await eseguiPrecarica(d, opz);
assert.deepEqual([r.richiesti, r.scaricati, r.errori, r.stop], [3, 3, 0, null]); assert.equal(st.attese, 2);
// ticker sconosciuto: segnato e si prosegue
({ st, d } = deps(["A", "ZZ", "C"], { ZZ: new ErroreServizio(404, "TICKER_NON_TROVATO", "x") }));
r = await eseguiPrecarica(d, opz); assert.deepEqual(st.errori, ["ZZ"]); assert.equal(r.scaricati, 2); assert.equal(r.errori, 1);
// limite giornaliero / al minuto: stop immediato
({ st, d } = deps(["A", "B", "C"], { B: new ErroreServizio(429, "LIMITE_GIORNALIERO", "x") }));
r = await eseguiPrecarica(d, opz); assert.equal(r.stop, "limite_giornaliero"); assert.deepEqual(st.scaricati, ["A"]);
({ st, d } = deps(["A", "B"], { A: new ErroreServizio(429, "LIMITE_MINUTO", "x") }));
r = await eseguiPrecarica(d, opz); assert.equal(r.stop, "limite_minuto");
({ st, d } = deps(["A", "B"], { A: new ErroreServizio(500, "CONFIG", "x") }));
r = await eseguiPrecarica(d, opz); assert.equal(r.stop, "configurazione");
// errore temporaneo: non segnato, si prosegue
({ st, d } = deps(["A", "B"], { A: new ErroreServizio(502, "ERRORE_DATI", "x") }));
r = await eseguiPrecarica(d, opz); assert.deepEqual(st.errori, []); assert.equal(r.scaricati, 1);
// tempo massimo
({ st, d } = deps(Array.from({ length: 30 }, (_, i) => "T" + i), {}));
r = await eseguiPrecarica(d, { ...opz, massimo: 30 }); assert.equal(r.stop, "tempo"); assert.ok(r.scaricati >= 15 && r.scaricati < 30);
// errore inatteso: propagato
({ st, d } = deps(["A"], { A: new Error("bug") })); await assert.rejects(eseguiPrecarica(d, opz), /bug/);
// il catalogo del server deve coincidere con quello del sito
import { readFileSync } from "node:fs";
import { CATALOGO_TICKER } from "../supabase/functions/_shared/catalogo_tickers.ts";
const w = {}; new Function("window", readFileSync("../public/catalogo.js", "utf8"))(w);
assert.deepEqual([...new Set(w.MA_CATALOGO.map((x) => x[0]))].sort(), [...CATALOGO_TICKER].sort(), "catalogo_tickers.ts non allineato a catalogo.js");
console.log("test_precarica OK");
