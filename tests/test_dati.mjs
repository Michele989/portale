// Collauda la cache dei prezzi e la gestione degli errori del servizio dati (con database e rete finti).
import assert from "node:assert/strict";
import { creaDati, ErroreServizio } from "../supabase/functions/_shared/dati.ts";
import * as A from "../supabase/functions/_shared/analisi.ts";

function righe(n) { return Array.from({ length: n }, (_, i) => ({ datetime: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), open: "100", high: "101", low: "99", close: String(100 + (i % 7)), volume: "1000" })).reverse(); }
function creaSb(cacheIniziale) {
  const st = { cache: cacheIniziale, upsert: 0 };
  return { st, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: st.cache }) }) }), upsert: async (r) => { st.upsert++; st.cache = { dati: r.dati, aggiornato_il: r.aggiornato_il }; return {}; } }) };
}
const compatta = (n) => A.comprimi(A.daTwelveData(righe(n)));
let risposta, chiamate = 0;
globalThis.fetch = async () => { chiamate++; return { json: async () => risposta }; };
const cfg = { tdKey: "K", cacheOre: 6, storicoGiorni: 1300 };
const ore = (h) => new Date(Date.now() - h * 3.6e6).toISOString();

// cache fresca: nessuna chiamata
let sb = creaSb({ dati: compatta(100), aggiornato_il: ore(1) }); chiamate = 0;
let r = await creaDati(sb, cfg).datiTitolo("AAA"); assert.equal(r.scaricato, false); assert.equal(chiamate, 0); assert.equal(r.barre.length, 100);
// cache scaduta: scarica e salva
risposta = { values: righe(120) }; sb = creaSb({ dati: compatta(100), aggiornato_il: ore(10) });
r = await creaDati(sb, cfg).datiTitolo("AAA"); assert.equal(r.scaricato, true); assert.equal(chiamate, 1); assert.equal(sb.st.upsert, 1); assert.equal(r.barre.length, 120);
// nessuna cache
sb = creaSb(null); r = await creaDati(sb, cfg).datiTitolo("AAA"); assert.equal(r.barre.length, 120);
// solo cache
sb = creaSb(null); await assert.rejects(creaDati(sb, cfg).datiTitolo("AAA", true), (e) => e instanceof ErroreServizio && e.codice === "NON_IN_CACHE");
sb = creaSb({ dati: compatta(100), aggiornato_il: ore(1) }); chiamate = 0; r = await creaDati(sb, cfg).datiTitolo("AAA", true); assert.equal(chiamate, 0);
// minAggiornato: una cache "fresca" ma scaricata prima della chiusura non vale
sb = creaSb({ dati: compatta(100), aggiornato_il: ore(2) }); chiamate = 0; risposta = { values: righe(130) };
r = await creaDati(sb, cfg).datiTitolo("AAA", false, new Date(Date.now() - 1 * 3.6e6)); assert.equal(r.scaricato, true); assert.equal(r.barre.length, 130);
await assert.rejects(creaDati(creaSb({ dati: compatta(100), aggiornato_il: ore(2) }), cfg).datiTitolo("AAA", true, new Date(Date.now() - 1 * 3.6e6)), /non ancora aggiornato/);
r = await creaDati(creaSb({ dati: compatta(100), aggiornato_il: ore(1) }), cfg).datiTitolo("AAA", true, new Date(Date.now() - 2 * 3.6e6)); assert.equal(r.scaricato, false);
// limite al minuto: usa la cache vecchia solo se accettabile
risposta = { code: 429, status: "error", message: "You have run out of API credits for the current minute" };
r = await creaDati(creaSb({ dati: compatta(100), aggiornato_il: ore(10) }), cfg).datiTitolo("AAA"); assert.equal(r.barre.length, 100, "fallback su cache vecchia");
await assert.rejects(creaDati(creaSb({ dati: compatta(100), aggiornato_il: ore(10) }), cfg).datiTitolo("AAA", false, new Date(Date.now() - 1 * 3.6e6)), (e) => e.codice === "LIMITE_MINUTO", "per gli avvisi niente dati pre-chiusura");
await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("AAA"), (e) => e.codice === "LIMITE_MINUTO" && e.extra.riprova_tra === 20);
risposta = { code: 429, status: "error", message: "You have run out of API credits for the day" };
await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("AAA"), (e) => e.codice === "LIMITE_GIORNALIERO");
// ticker inesistente, storico corto, chiave mancante, rete assente
risposta = { code: 400, status: "error", message: "**symbol** not found" };
await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("ZZZ"), (e) => e.codice === "TICKER_NON_TROVATO" && e.stato === 404);
risposta = { values: righe(30) }; await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("AAA"), (e) => e.codice === "DATI_INSUFFICIENTI");
await assert.rejects(creaDati(creaSb(null), { ...cfg, tdKey: "" }).datiTitolo("AAA"), (e) => e.codice === "CONFIG");
risposta = { code: 401, status: "error", message: "apikey parameter is incorrect" };
await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("AAA"), (e) => e.codice === "CONFIG" && /401/.test(e.message));
risposta = { code: 403, status: "error", message: "available starting with Grow plan" };
await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("AAA"), (e) => e.codice === "PIANO_DATI");
risposta = { code: 500, status: "error", message: "boom" };
await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("AAA"), (e) => e.codice === "ERRORE_DATI" && /500/.test(e.message) && /boom/.test(e.message));
globalThis.fetch = async () => { throw new Error("rete"); };
await assert.rejects(creaDati(creaSb(null), cfg).datiTitolo("AAA"), (e) => e.codice === "ERRORE_DATI");
console.log("test_dati OK");
