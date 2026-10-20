// =========================================================================
// SMOKE TEST sul sito VERO (gratuito): verifica pagine, login, database,
// analisi, scalo dell'uso e protezione del pannello admin.
// Uso:  SITE_URL=https://xxx.netlify.app SUPABASE_URL=https://yyy.supabase.co \
//       SUPABASE_ANON_KEY=... SMOKE_EMAIL=... SMOKE_PASSWORD=... node smoke_live.mjs
// Usa un account di PROVA con una chiave attiva (ogni esecuzione consuma 1 uso;
// SMOKE_ANALISI=0 per saltare l'analisi). Esce con codice 1 se qualcosa non va.
// =========================================================================
const env = process.env;
const richieste = ["SITE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SMOKE_EMAIL", "SMOKE_PASSWORD"];
const mancanti = richieste.filter((k) => !env[k]);
if (mancanti.length) { console.error("Variabili mancanti: " + mancanti.join(", ")); process.exit(2); }
const SITE = env.SITE_URL.replace(/\/$/, ""), SB = env.SUPABASE_URL.replace(/\/$/, ""), KEY = env.SUPABASE_ANON_KEY;
const TICKER = env.SMOKE_TICKER || "AAPL";

let falliti = 0;
function esito(ok, nome, dettaglio = "") {
  console.log((ok ? "OK    " : "FALLITO ") + nome + (dettaglio ? " — " + dettaglio : ""));
  if (!ok) falliti++;
  return ok;
}
async function chiedi(url, opz = {}) {
  try {
    const r = await fetch(url, { ...opz, signal: AbortSignal.timeout(60000) });
    let corpo = null; const t = await r.text();
    try { corpo = JSON.parse(t); } catch (_e) { corpo = t; }
    return { stato: r.status, corpo };
  } catch (e) { return { stato: 0, corpo: String(e) }; }
}

// 1) pagine statiche
for (const f of ["index.html", "admin.html", "istruzioni.html", "termini.html", "privacy.html", "metodo.html", "disiscrizione.html", "config.js", "manifest.webmanifest"]) {
  const r = await chiedi(SITE + "/" + f);
  esito(r.stato === 200, "pagina " + f, "HTTP " + r.stato);
  if (f === "config.js") esito(typeof r.corpo === "string" && !/INSERISCI/.test(r.corpo), "config.js compilato");
}

// 2) login
const login = await chiedi(SB + "/auth/v1/token?grant_type=password", {
  method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD }),
});
if (!esito(login.stato === 200 && login.corpo && login.corpo.access_token, "login account di prova", "HTTP " + login.stato)) fine();
const H = { apikey: KEY, Authorization: "Bearer " + login.corpo.access_token, "Content-Type": "application/json" };

// 3) database con permessi
const prof = await chiedi(SB + "/rest/v1/profiles?select=username", { headers: H });
esito(prof.stato === 200 && Array.isArray(prof.corpo) && prof.corpo.length === 1, "lettura del proprio profilo (e di nessun altro)", "HTTP " + prof.stato + ", righe " + (Array.isArray(prof.corpo) ? prof.corpo.length : "?"));
const leggiUsi = async () => {
  const r = await chiedi(SB + "/rest/v1/access_keys?select=usi_rimasti,stato&order=id.desc&limit=1", { headers: H });
  return r.stato === 200 && Array.isArray(r.corpo) && r.corpo[0] ? r.corpo[0] : null;
};
const prima = await leggiUsi();
esito(!!prima && prima.stato === "attiva" && prima.usi_rimasti > 0, "l'account di prova ha una chiave attiva con usi", prima ? prima.usi_rimasti + " usi" : "nessuna chiave");
const tr = await chiedi(SB + "/rest/v1/rpc/track_record", { method: "POST", headers: H, body: "{}" });
esito(tr.stato === 200 && tr.corpo && typeof tr.corpo === "object", "track record leggibile", "HTTP " + tr.stato);
const altre = await chiedi(SB + "/rest/v1/segnali?select=id", { headers: H });
esito(altre.stato === 200 && Array.isArray(altre.corpo) && altre.corpo.length === 0, "tabella segnali non leggibile dai clienti");

// 4) sicurezza funzioni
const senza = await chiedi(SB + "/functions/v1/analizza", { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ ticker: TICKER }) });
esito(senza.stato === 401 || senza.stato === 403, "analisi senza login rifiutata", "HTTP " + senza.stato);
const avv = await chiedi(SB + "/functions/v1/avvisi", { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: "{}" });
esito(avv.stato === 401, "funzione avvisi protetta dal segreto", "HTTP " + avv.stato + (avv.stato === 404 ? " (non pubblicata: esegui INSTALLA_AVVISI.bat)" : ""));
const dis = await chiedi(SB + "/functions/v1/disiscrivi?t=non-valido", { method: "POST", headers: { apikey: KEY } });
esito(dis.stato === 400, "disiscrizione rifiuta token non valido", "HTTP " + dis.stato);
const adm = await chiedi(SB + "/functions/v1/admin", { method: "POST", headers: H, body: JSON.stringify({ azione: "elenco" }) });
esito(adm.stato === 403, "pannello admin rifiutato a un cliente normale", "HTTP " + adm.stato);

// 5) analisi vera + scalo dell'uso
if (env.SMOKE_ANALISI === "0") console.log("(analisi saltata)");
else {
  const an = await chiedi(SB + "/functions/v1/analizza", { method: "POST", headers: H, body: JSON.stringify({ ticker: TICKER, tp: 8, sl: 8, comm: 0.2, spread: 0.1 }) });
  const b = an.corpo || {};
  esito(an.stato === 200 && b.ok === true, "analisi " + TICKER, an.stato === 200 ? "" : "HTTP " + an.stato + " " + (b.errore || b.codice || ""));
  if (b.ok) {
    esito(typeof b.prezzo === "number" && b.prezzo > 0 && b.backtest && typeof b.backtest.n === "number" && b.giorniStorico >= 60, "risposta completa", "storico " + b.giorniStorico + " giorni");
    esito(b.giorniStorico >= 900, "storico lungo (verifica STORICO_GIORNI)", b.giorniStorico + " giorni");
    esito(prima && b.usi_rimasti === prima.usi_rimasti - 1, "usi scalati di 1", (prima ? prima.usi_rimasti : "?") + " → " + b.usi_rimasti);
    const dopo = await leggiUsi();
    esito(dopo && prima && dopo.usi_rimasti === prima.usi_rimasti - 1, "contatore nel database coerente");
  }
}
fine();
function fine() {
  console.log(falliti ? "\n" + falliti + " controlli FALLITI" : "\nTutti i controlli superati");
  process.exit(falliti ? 1 : 0);
}
