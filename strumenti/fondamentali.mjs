// Test dei bilanci (SEC EDGAR) con fattori Fama-French e contesto macro FRED.
// Uso (GitHub Actions): DATABASE_URL=... node --experimental-strip-types --no-warnings strumenti/fondamentali.mjs
import pg from "pg";
import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { espandi } from "../supabase/functions/_shared/analisi.ts";
import { estraiBilanci, indicatori, testFondamentali, leggiFamaFrench, leggiFred, ultimoPerMese } from "../supabase/functions/_shared/fondamentali.ts";

const url = process.env.DATABASE_URL;
if (!url) { console.error("Manca DATABASE_URL"); process.exit(1); }
const UA = process.env.SEC_USER_AGENT || "Tickly ricerca personale tickly-ricerca@users.noreply.github.com";
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));
async function scarica(u, opz = {}) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(u, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip" }, ...opz }); if (r.status === 404) return null; if (!r.ok) throw new Error("HTTP " + r.status); return r; }
    catch (e) { if (t === 2) { console.log("  non riuscito:", u, String(e.message || e)); return null; } await attendi(1500 * (t + 1)); }
  }
}

// 1) prezzi dal database
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows: elenco } = await client.query(`select ticker from price_cache where not (dati ? 'err') and jsonb_array_length(dati->'b') >= 600 and ticker <> 'EURUSD' and ticker !~ '[.]' order by ticker`);
console.log("Titoli senza suffisso estero:", elenco.length);

// 2) mappa ticker -> CIK
const mappaR = await scarica("https://www.sec.gov/files/company_tickers.json");
if (!mappaR) { console.error("Impossibile leggere l'elenco SEC"); process.exit(1); }
const mappa = new Map(Object.values(await mappaR.json()).map((x) => [x.ticker.toUpperCase(), String(x.cik_str).padStart(10, "0")]));

// 3) bilanci
const titoli = []; let senzaBilancio = 0;
for (const { ticker } of elenco) {
  const cik = mappa.get(ticker); if (!cik) { senzaBilancio++; continue; }
  await attendi(130); // la SEC ammette al massimo 10 richieste al secondo
  const r = await scarica(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`); if (!r) { senzaBilancio++; continue; }
  const bil = estraiBilanci(await r.json()); if (bil.length < 4) { senzaBilancio++; continue; }
  const { rows } = await client.query(`select dati from price_cache where ticker = $1`, [ticker]);
  titoli.push({ ticker, cron: espandi(rows[0].dati).reverse().map((b) => ({ d: b.d, c: b.c })), ind: indicatori(bil) });
  if (titoli.length % 25 === 0) console.log("  bilanci letti:", titoli.length);
}
await client.end();
console.log("Titoli con bilanci:", titoli.length, "| senza bilanci (ETF, esteri, altro):", senzaBilancio);

// 4) fattori Fama-French e macro FRED (se un file non scarica, il test prosegue senza)
function zipTesto(buf) { const d = mkdtempSync(join(tmpdir(), "ff-")), f = join(d, "a.zip"); writeFileSync(f, Buffer.from(buf)); return execFileSync("unzip", ["-p", f], { maxBuffer: 50e6 }).toString("latin1"); }
const FF = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/";
let ff, mom, curva, vix;
try { const r = await scarica(FF + "F-F_Research_Data_5_Factors_2x3_CSV.zip"); if (r) ff = leggiFamaFrench(zipTesto(await r.arrayBuffer())); } catch (e) { console.log("Fama-French non letto:", e.message); }
try { const r = await scarica(FF + "F-F_Momentum_Factor_CSV.zip"); if (r) mom = leggiFamaFrench(zipTesto(await r.arrayBuffer())); } catch (e) { console.log("Momentum non letto:", e.message); }
try { const r = await scarica("https://fred.stlouisfed.org/graph/fredgraph.csv?id=T10Y2Y"); if (r) curva = ultimoPerMese(leggiFred(await r.text())); } catch (e) { console.log("FRED curva non letto:", e.message); }
try { const r = await scarica("https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS"); if (r) vix = ultimoPerMese(leggiFred(await r.text())); } catch (e) { console.log("FRED VIX non letto:", e.message); }
console.log("Fattori FF:", ff ? ff.size + " mesi" : "no", "| momentum:", mom ? mom.size : "no", "| curva tassi:", curva ? curva.size : "no", "| VIX:", vix ? vix.size : "no");

// 5) test
const esito = testFondamentali(titoli, { ff, mom: mom || undefined, curva, vix, B: 2000 });
esito.universo = { titoli: titoli.length, senza_bilancio: senzaBilancio, fama_french: !!ff, momentum: !!mom, fred: !!(curva && vix) };
writeFileSync("fondamentali.json", JSON.stringify(esito, null, 2));
const f = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? "n.d." : Number(x).toFixed(d));
console.log("\n===== RISULTATO BILANCI =====");
console.log("Titoli:", titoli.length);
console.log("Spread = quinto migliore meno quinto peggiore, rendimento del mese dopo, punti %\n");
for (const r of esito.indicatori) {
  if (r.nota) { console.log(`  ${r.indicatore}: ${r.nota}`); continue; }
  console.log(`  ${r.indicatore.padEnd(15)} spread ${f(r.media)} [${f(r.ci95[0])} ; ${f(r.ci95[1])}] p(Holm)=${f(r.pHolm, 3)} | recente ${f(r.recente && r.recente.media)} | alfa FF ${f(r.fattori && r.fattori.alfa)} (t=${f(r.fattori && r.fattori.t, 1)}) | mesi ${r.mesi}`);
  if (r.curva_invertita_vs_normale) console.log(`      curva tassi invertita ${f(r.curva_invertita_vs_normale.media_a)} (${r.curva_invertita_vs_normale.mesi_a} mesi) vs normale ${f(r.curva_invertita_vs_normale.media_b)} | VIX alto ${f(r.vix_alto_vs_basso && r.vix_alto_vs_basso.media_a)} vs basso ${f(r.vix_alto_vs_basso && r.vix_alto_vs_basso.media_b)}`);
}
console.log("\nCONCLUSIONE:", esito.conclusione);
console.log("\nNote:"); for (const n of esito.note) console.log(" -", n);
