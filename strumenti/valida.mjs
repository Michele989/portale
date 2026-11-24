// Validazione dell'intero universo: legge i prezzi salvati, esegue il backtest e salva il risultato.
// Uso (da GitHub Actions): DATABASE_URL=... node --experimental-strip-types --no-warnings strumenti/valida.mjs
import pg from "pg";
import { writeFileSync } from "node:fs";
import { espandi } from "../supabase/functions/_shared/analisi.ts";
import { ricalibrazione } from "../supabase/functions/_shared/calibrazione.ts";
import { validazioneCompleta, VERSIONE_VALIDAZIONE } from "../supabase/functions/_shared/validazione.ts";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Manca DATABASE_URL"); process.exit(1); }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: elenco } = await client.query(`select ticker from price_cache where not (dati ? 'err') and jsonb_array_length(dati->'b') >= 600 and ticker <> 'EURUSD' order by ticker`);
console.log("Titoli con storico sufficiente:", elenco.length);
const serie = []; let spy = null;
for (const { ticker } of elenco) {
  const { rows } = await client.query(`select dati from price_cache where ticker = $1`, [ticker]);
  const cron = espandi(rows[0].dati).reverse(); // dal piu' vecchio
  if (ticker === "SPY") spy = cron;
  serie.push({ ticker, cron });
}
const aperture = serie.reduce((a, s) => a + s.cron.filter((b) => b.o).length, 0), tot = serie.reduce((a, s) => a + s.cron.length, 0);
console.log("Barre totali:", tot, "| con apertura:", Math.round(100 * aperture / tot) + "%");
const inizio = Date.now();
const esito = validazioneCompleta(serie, spy, { B: 2000, seed: VERSIONE_VALIDAZIONE });
// ricalibrazione automatica: solo con esiti reali maturati (le previsioni nuove ne producono col tempo)
esito.ricalibrazione = {};
try {
  const { rows: pe } = await client.query(`select p.modello, p.orizzonte, p.data_prev::text as data, p.prob_su::float as p, case when e.su then 1 else 0 end as y from previsioni p join previsioni_esiti e on e.previsione_id = p.id`);
  for (const m of ["base", "simili", "bootstrap", "garch"]) for (const h of [21, 63, 252]) {
    const punti = pe.filter((x) => x.modello === m && x.orizzonte === h).map((x) => ({ p: x.p, y: x.y, data: x.data }));
    if (punti.length) esito.ricalibrazione[m + "_" + h] = ricalibrazione(punti);
  }
} catch (e) { esito.ricalibrazione = { errore: String(e.message || e) }; }
esito.durata_s = Math.round((Date.now() - inizio) / 1000);
esito.quota_barre_con_apertura = Math.round(100 * aperture / tot);
writeFileSync("validazione.json", JSON.stringify(esito, null, 2));
await client.query(`insert into validazioni(versione, esito) values ($1, $2)`, [VERSIONE_VALIDAZIONE, JSON.stringify(esito)]);
await client.query(`delete from validazioni where id not in (select id from validazioni order by eseguita_il desc limit 24)`);
await client.end();

const f = (x, d = 2) => (x === null || x === undefined ? "n.d." : Number(x).toFixed(d));
console.log("\n===== RISULTATO DELLA VALIDAZIONE =====");
console.log("Universo:", esito.universo.titoli, "titoli, dal", esito.universo.dal, "al", esito.universo.al);
console.log("\nREGOLE (eccesso del rendimento rispetto alla media dei titoli nella stessa data, in punti %):");
for (const r of esito.regole) {
  console.log(`  ${r.regola.padEnd(11)} ${String(r.orizzonte).padStart(3)}g  eccesso ${f(r.media)} [${f(r.ci95 && r.ci95[0])} ; ${f(r.ci95 && r.ci95[1])}]  p(Holm)=${f(r.pHolm, 3)}  recente: ${f(r.recente.media)} [${f(r.recente.ci95 && r.recente.ci95[0])} ; ${f(r.recente.ci95 && r.recente.ci95[1])}]  oss=${r.osservazioni}`);
}
console.log("\nPROBABILITA' (BSS > 0 = i 'simili' battono la base; intervallo al 95%):");
for (const p of esito.probabilita) console.log(`  ${p.orizzonte}g  intero BSS ${f(p.intero.bss, 4)} [${f(p.intero.ci95 && p.intero.ci95[0], 4)} ; ${f(p.intero.ci95 && p.intero.ci95[1], 4)}]  recente ${f(p.recente.bss, 4)}  oss=${p.intero.osservazioni}`);
if (esito.realityCheck) console.log(`\nREALITY CHECK (il migliore tra ${esito.realityCheck.test} test): migliore = ${esito.realityCheck.migliore}, p = ${f(esito.realityCheck.pValore, 3)}`);
for (const d of esito.distribuzioni || []) console.log(`DISTRIBUZIONE ${d.orizzonte}g: CRPS storica ${f(d.crps_empirica, 3)} vs normale ${f(d.crps_normale, 3)} (skill ${f(d.skill_vs_normale, 3)}), PIT ${d.pit_decimi.map((x) => Math.round(x * 100)).join("/")}%`);
for (const c of esito.calibrazione_lineare || []) console.log(`CALIBRAZIONE ${c.orizzonte}g: simili pendenza ${f(c.simili && c.simili.pendenza, 2)} intercetta ${f(c.simili && c.simili.intercetta, 2)} | base pendenza ${f(c.base && c.base.pendenza, 2)} (1 = perfetta)`);
if (esito.qualita_dati) console.log(`QUALITA' DATI: ${esito.qualita_dati.con_anomalie} titoli su ${esito.qualita_dati.titoli} con anomalie`);
for (const [k, v] of Object.entries(esito.ricalibrazione || {})) console.log(`RICALIBRAZIONE ${k}: ${v.attiva ? "ATTIVA" : "non attiva"} - ${v.nota || ""}`);
console.log("\nCONCLUSIONE:", esito.conclusione);
console.log("\nNote:"); for (const n of esito.note) console.log(" -", n);
