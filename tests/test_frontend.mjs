import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as A from "../supabase/functions/_shared/analisi.ts";
import * as O from "../supabase/functions/_shared/orizzonti.ts";

const P = "../public/";
const leggi = (f) => readFileSync(P + f, "utf8");
const attendi = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function finche(cond, msg, t = 4000) { const s = Date.now(); while (Date.now() - s < t) { if (await cond()) return; await attendi(15); } throw new Error("Timeout: " + msg); }

// ---------- serie sintetiche ----------
function serie(n, seed, drift, crollo = 0) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    let r = (rnd() - 0.5) * 0.02 + drift; if (i >= n - 14) r = -crollo;
    const c = p * (1 + r);
    cron.push({ d: new Date(2022, 0, 1 + i).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 });
    p = c;
  }
  return cron.reverse();
}
const DATI = (t) => t === "TSLA" || t === "ARKK" ? serie(900, 7, 0.0006, 0.012) : serie(900, t.charCodeAt(0) * 31 + t.length, 0.0005);
assert.equal(A.analizzaSerie(DATI("TSLA"), { tp: 8, sl: 8, comm: 0.2 }).stato, "ipervenduto", "TSLA sintetico ipervenduto");

// ---------- supabase finto ----------
function nuovoDb() { return { profiles: [], admins: [], access_keys: [], watchlist: [], portfolio: [], impostazioni_rischio: [] }; }
const CHIAVI_UNICHE = { watchlist: ["user_id", "ticker"], portfolio: ["user_id", "ticker"], impostazioni_rischio: ["user_id"] };
function creaSb(db, ctx) {
  const listeners = [];
  ctx.emit = (ev) => listeners.forEach((f) => f(ev));
  const sb = {
    auth: {
      async getSession() { return { data: { session: ctx.session } }; },
      async signInWithPassword({ email, password }) {
        const u = ctx.utenti.find((x) => x.email === email && x.password === password);
        if (!u) return { error: { message: "Invalid" } };
        ctx.session = { access_token: "tok-" + u.id, user: { id: u.id, email: u.email } }; return { data: { session: ctx.session }, error: null };
      },
      async signUp({ email, password, options }) {
        const id = "u" + (ctx.utenti.length + 1); ctx.utenti.push({ id, email, password });
        db.profiles.push({ user_id: id, username: options.data.username, email, created_at: new Date().toISOString() });
        ctx.session = ctx.confermaEmail ? null : { access_token: "tok-" + id, user: { id, email } };
        ctx.ultimoSignUp = options; return { data: { session: ctx.session }, error: null };
      },
      async signOut() { ctx.session = null; listeners.forEach((f) => f("SIGNED_OUT")); return {}; },
      async resetPasswordForEmail(email, o) { ctx.reset = { email, o }; return { error: null }; },
      async updateUser(x) { ctx.pwCambiata = x.password; return { error: null }; },
      onAuthStateChange(f) { listeners.push(f); return { data: {} }; },
    },
    async rpc(nome, args) {
      if (nome === "track_record") return { data: ctx.track || { chiusi: 0, vinti: 0, persi: 0, scaduti: 0, aperti: 2, calibrazione: [] } };
      if (nome === "statistiche_aggregate") return { data: ctx.aggregate || [] };
      if (nome === "username_disponibile") return { data: !db.profiles.some((p) => p.username.toLowerCase() === args.p_username.toLowerCase()) }; return { data: null }; },
    from(tab) {
      let filtri = [], op = "select", payload, opts, ord, lim;
      const righe = () => db[tab].filter((r) => filtri.every(([c, v]) => r[c] === v));
      async function exec(single) {
        if (op === "select") {
          let r = righe().map((x) => ({ ...x }));
          if (ord) r.sort((a, b) => (a[ord[0]] < b[ord[0]] ? 1 : -1) * (ord[1].ascending === false ? 1 : -1));
          if (lim) r = r.slice(0, lim);
          return single ? { data: r[0] || null, error: null } : { data: r, error: null };
        }
        if (op === "delete") { db[tab] = db[tab].filter((r) => !filtri.every(([c, v]) => r[c] === v)); return { error: null }; }
        const lista = Array.isArray(payload) ? payload : [payload];
        const uniq = CHIAVI_UNICHE[tab] || [];
        for (const nuova of lista) {
          const es = uniq.length ? db[tab].find((r) => uniq.every((k) => r[k] === nuova[k])) : null;
          if (es) { if (op === "insert") return { error: { message: "duplicate" } }; Object.assign(es, nuova); }
          else db[tab].push({ id: db[tab].length + 1, ...nuova });
        }
        return { error: null };
      }
      const api = {
        select() { return api; }, eq(c, v) { filtri.push([c, v]); return api; }, order(c, o) { ord = [c, o]; return api; }, limit(n) { lim = n; return api; },
        insert(p) { op = "insert"; payload = p; return api; }, upsert(p, o) { op = "upsert"; payload = p; opts = o; return api; }, delete() { op = "delete"; return api; },
        maybeSingle() { return exec(true); }, then(a, b) { return exec(false).then(a, b); },
      };
      return api;
    },
  };
  return sb;
}

// ---------- "server" finto: stessa logica delle Edge Functions ----------
function creaFetch(db, ctx) {
  return async (url, init) => {
    const body = JSON.parse(init.body || "{}");
    const uid = (init.headers.Authorization || "").replace("Bearer tok-", "");
    const J = (o, status = 200) => ({ status, json: async () => o });
    ctx.chiamate.push({ url, body });
    if (url.endsWith("/analizza")) {
      const k = db.access_keys.filter((x) => x.user_id === uid).sort((a, b) => b.id - a.id)[0];
      if (!k) return J({ ok: false, codice: "NESSUNA_CHIAVE", errore: "Accesso non abilitato" }, 403);
      if (k.stato !== "attiva") return J({ ok: false, codice: "DISATTIVATA", errore: "Chiave disattivata" }, 403);
      if (k.usi_rimasti <= 0) return J({ ok: false, codice: "USI_ESAURITI", errore: "Usi esauriti" }, 403);
      k.usi_rimasti--;
      if (body.ticker === "ZZZZ") { k.usi_rimasti++; return J({ ok: false, codice: "TICKER_NON_TROVATO", errore: "Ticker non trovato: ZZZZ", usi_rimasti: k.usi_rimasti }, 404); }
      if (body.ticker === "LENTO" && !ctx.lentoFatto) { ctx.lentoFatto = true; k.usi_rimasti++; return J({ ok: false, codice: "LIMITE_MINUTO", errore: "x", riprova_tra: 0.05, usi_rimasti: k.usi_rimasti }, 429); }
      const bars = DATI(body.ticker);
      const an = A.analizzaSerie(bars, { tp: body.tp, sl: body.sl, comm: body.comm, spread: body.spread }, { oggi: new Date(bars[0].d + "T12:00:00Z"), mercato: ctx.mercatoGiu ? { ticker: "SPY", prezzo: 1, sma200: 2, distanza: -10, sopraSma200: false } : null });
      return J({ ok: true, ticker: body.ticker, ...an, orizzonti: O.analizzaOrizzonti(bars.slice().reverse(), { datiOk: true }), dati_del: new Date(Date.now() - 3600e3).toISOString(), usi_rimasti: k.usi_rimasti });
    }
    if (url.endsWith("/admin")) {
      const adm = db.admins.some((a) => a.user_id === uid);
      if (!adm) return J({ ok: false, errore: "Accesso riservato all'amministratore." }, 403);
      if (body.azione === "elenco") {
        const utenti = db.profiles.map((p) => ({ ...p, admin: db.admins.some((a) => a.user_id === p.user_id), chiave: db.access_keys.filter((k) => k.user_id === p.user_id).sort((a, b) => b.id - a.id)[0] || null }));
        return J({ ok: true, utenti, stats: { utenti: utenti.length, senza_chiave: utenti.filter((u) => !u.chiave).length, attive: 0, usi_rimasti_totali: 0, usi_consumati_totali: 0, avvisi_attivi: 2, avvisi_7gg: 5 } });
      }
      if (body.azione === "crea_chiave") {
        const p = db.profiles.find((x) => x.username.toLowerCase() === body.username.toLowerCase());
        if (!p) return J({ ok: false, errore: "Utente non trovato." }, 404);
        db.access_keys.filter((k) => k.user_id === p.user_id && k.stato === "attiva").forEach((k) => (k.stato = "sostituita"));
        db.access_keys.push({ id: db.access_keys.length + 1, user_id: p.user_id, codice: "MA-TEST-TEST-TEST", stato: "attiva", usi_totali: body.usi, usi_rimasti: body.usi, scade_il: null, creata_il: new Date().toISOString(), ultimo_uso_il: null, note: body.note });
        return J({ ok: true, codice: "MA-TEST-TEST-TEST", username: p.username, usi: body.usi, giorni: body.giorni });
      }
      if (body.azione === "imposta_stato") { db.access_keys.find((k) => k.id === body.chiave_id).stato = body.stato; return J({ ok: true }); }
      return J({ ok: false, errore: "?" }, 400);
    }
    return J({}, 404);
  };
}

// ---------- caricamento pagina ----------
async function carica(file, { db, ctx, config = true }) {
  let html = leggi(file).replace(/<script src="https:\/\/cdn[^>]*><\/script>/, "");
  let cfg = leggi("config.js").replace("INSERISCI_URL_PROGETTO_SUPABASE", config ? "https://prova.supabase.co" : "INSERISCI").replace("INSERISCI_ANON_KEY_SUPABASE", config ? "k".repeat(40) : "x").replace("PAUSA_MS: 7700", "PAUSA_MS: 0");
  html = html.replace('<script src="config.js"></script>', "<script>" + cfg + "</script>").replace('<script src="comune.js"></script>', "<script>" + leggi("comune.js") + "</script>").replace('<script src="catalogo.js"></script>', "<script>" + leggi("catalogo.js") + "</script>");
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: "https://prova.netlify.app/" + file, pretendToBeVisual: true,
    beforeParse(w) {
      w.supabase = { createClient: () => creaSb(db, ctx) };
      w.fetch = creaFetch(db, ctx);
      w.confirm = () => ctx.conferma !== false; w.prompt = () => ctx.promptRisposta ?? null;
      w.scrollTo = () => {};
      w.errori = []; w.addEventListener("error", (e) => w.errori.push(e.message));
    },
  });
  await attendi(30);
  return dom;
}
const $ = (d, id) => d.window.document.getElementById(id);
const click = (d, el) => el.dispatchEvent(new d.window.MouseEvent("click", { bubbles: true }));
const invia = (d, form) => form.dispatchEvent(new d.window.Event("submit", { bubbles: true, cancelable: true }));
const testo = (d, id) => $(d, id).textContent.replace(/\s+/g, " ");

// =============== 0) non configurato ===============
{
  const d = await carica("index.html", { db: nuovoDb(), ctx: { utenti: [], chiamate: [] }, config: false });
  assert.ok(!$(d, "avvisoConfig").classList.contains("hidden"), "avviso configurazione");
  assert.deepEqual(d.window.errori, []);
}

// =============== 1) registrazione + attesa ===============
const db = nuovoDb(), ctx = { utenti: [], chiamate: [], session: null };
db.profiles.push({ user_id: "u0", username: "Mario", email: "m@x.it", created_at: "2026-01-01T00:00:00Z" });
ctx.utenti.push({ id: "u0", email: "m@x.it", password: "x" });
let d = await carica("index.html", { db, ctx });
assert.ok(!$(d, "vistaAuth").classList.contains("hidden"), "mostra login");
click(d, $(d, "tabRegistrati"));
$(d, "regUsername").value = "mario"; $(d, "regEmail").value = "n@x.it"; $(d, "regPassword").value = "password1"; $(d, "regTermini").checked = true;
invia(d, $(d, "formRegistrati"));
await attendi(40);
assert.match(testo(d, "authMsg"), /già in uso/, "username duplicato rifiutato");
$(d, "regUsername").value = "luca_88";
invia(d, $(d, "formRegistrati"));
await finche(() => !$(d, "vistaApp").classList.contains("hidden"), "area cliente dopo registrazione");
assert.equal(ctx.ultimoSignUp.data.username, "luca_88"); assert.equal(ctx.ultimoSignUp.data.termini, "true");
await finche(() => $(d, "boxStato").textContent.includes("In attesa di abilitazione"), "schermata attesa");
assert.ok($(d, "boxStato").textContent.includes("luca_88"), "username mostrato");
assert.equal($(d, "btnAnalizzaTutto").disabled, true, "analisi bloccata senza chiave");
assert.equal(db.watchlist.filter((w) => w.tipo === "etf").length, 8); assert.equal(db.watchlist.filter((w) => w.tipo === "crescita").length, 5);
assert.equal(db.watchlist.filter((w) => w.tipo === "azioni").length, 0, "azioni vuote di default");

// =============== 2) abilitazione e analisi ===============
db.access_keys.push({ id: 1, user_id: "u2", codice: "MA-AAAA-BBBB-CCCC", stato: "attiva", usi_totali: 20, usi_rimasti: 20, scade_il: null });
click(d, $(d, "btnRicontrolla"));
await finche(() => $(d, "boxStato").textContent.includes("Ti restano"), "contatore");
assert.match(testo(d, "boxStato"), /Ti restano 20 usi su 20/);
// pochi usi: bloccato prima di partire
db.access_keys[0].usi_rimasti = 3; click(d, $(d, "btnAnalizzaTutto")); // stato locale ancora 20 -> parte? no: ricarico
db.access_keys[0].usi_rimasti = 20;
click(d, $(d, "btnAnalizzaTutto"));
await finche(() => /Completato/.test($(d, "progresso").textContent), "fine analisi", 15000);
assert.equal(d.window.document.querySelectorAll("#risultati .card").length >= 13 - 1, true, "schede mostrate");
assert.match(testo(d, "boxStato"), /Ti restano 7 usi su 20/, "contatore aggiornato: " + testo(d, "boxStato"));
assert.ok(testo(d, "boxIpervenduti").includes("ARKK"), "ARKK tra gli ipervenduti in cima");
assert.ok($(d, "risultati").innerHTML.includes("<svg"), "grafici");
// orizzonte di investimento: classifica, studio nella scheda, cambio di orizzonte
assert.equal(d.window.document.querySelectorAll("#orizzonteBtns button").length, 3, "tre orizzonti");
assert.match(testo(d, "boxClassifica"), /Classifica · Medio termine/, "classifica sul medio di default");
assert.ok(d.window.document.querySelectorAll("#boxClassifica tr[data-vai]").length >= 5, "righe in classifica");
assert.ok(d.window.document.querySelector("#risultati .card svg.ventaglio"), "ventaglio simulato nella scheda");
assert.match(testo(d, "risultati"), /Esempio di andamento possibile/);
assert.match(testo(d, "risultati"), /non sono previsioni/);
click(d, d.window.document.querySelector('[data-oz="lungo"]')); await attendi(30);
assert.match(testo(d, "boxClassifica"), /Classifica · Lungo termine/, "cambio orizzonte");
assert.match(testo(d, "risultati"), /Lungo termine \(circa 1 anno\)/);
click(d, d.window.document.querySelector('[data-oz="breve"]')); await attendi(30);
assert.match(testo(d, "boxClassifica"), /Breve termine/);
click(d, d.window.document.querySelector('[data-oz="medio"]')); await attendi(30);
if (process.env.SNAP) { const { writeFileSync } = await import("node:fs"); writeFileSync(process.env.SNAP, "<!doctype html>" + d.window.document.documentElement.outerHTML.replace(/<script[\s\S]*?<\/script>/g, "")); }
assert.deepEqual(d.window.errori, []);
assert.match(testo(d, "risultati"), /intervallo 95%/);
assert.equal(ctx.chiamate.every((c) => c.body.tp === 8 && c.body.sl === 8), true, "parametri inviati");
assert.deepEqual(d.window.errori, []);

// pochi usi
db.access_keys[0].usi_rimasti = 3;
click(d, $(d, "btnRicontrolla") || $(d, "btnAnalizzaTutto"));
await caricaChiaveDi(d); async function caricaChiaveDi(dd) { dd.window.__MA_APP.S.chiave.usi_rimasti = 3; }
click(d, $(d, "btnAnalizzaTutto"));
await finche(() => /Servono 13 usi/.test($(d, "progresso").textContent), "blocco usi insufficienti");
db.access_keys[0].usi_rimasti = 7; d.window.__MA_APP.S.chiave.usi_rimasti = 7;

// annulla conferma
ctx.conferma = false; const n0 = ctx.chiamate.length; click(d, $(d, "btnAnalizzaTutto")); await attendi(50); assert.equal(ctx.chiamate.length, n0, "nessun uso senza conferma"); ctx.conferma = true;

// ticker inesistente e aggiunta/rimozione
$(d, "nuovoTicker").value = "zzzz"; invia(d, $(d, "formTicker")); await attendi(60);
assert.ok(db.watchlist.some((w) => w.ticker === "ZZZZ"));
$(d, "nuovoTicker").value = "bad ticker"; invia(d, $(d, "formTicker")); await attendi(30);
assert.match(testo(d, "msgLista"), /non valido/);
$(d, "nuovoTicker").value = "ZZZZ"; invia(d, $(d, "formTicker")); await attendi(30);
assert.match(testo(d, "msgLista"), /già nella lista/);
// ricerca per nome nel catalogo, suggerimenti e pacchetti
$(d, "nuovoTicker").value = "gold"; $(d, "nuovoTicker").dispatchEvent(new d.window.Event("input"));
await attendi(20);
assert.ok(!$(d, "suggerimenti").classList.contains("hidden") && $(d, "suggerimenti").textContent.includes("GLD"), "suggerimenti per nome");
click(d, $(d, "suggerimenti").querySelector('[data-t="GLD"]')); await attendi(60);
assert.ok(db.watchlist.some((w) => w.ticker === "GLD" && w.tipo === "etf"), "GLD aggiunto dal suggerimento (era gia' presente: nessun doppione)");
$(d, "nuovoTicker").value = "Netflix"; invia(d, $(d, "formTicker")); await attendi(60);
assert.ok(db.watchlist.some((w) => w.ticker === "NFLX" && w.tipo === "azioni"), "nome completo risolto nel ticker");
$(d, "nuovoTicker").value = "ishares"; invia(d, $(d, "formTicker")); await attendi(30);
assert.match(testo(d, "msgLista"), /Più risultati/, "nome ambiguo: chiede di scegliere");
const prima2 = db.watchlist.filter((w) => w.user_id === "u2").length;
click(d, $(d, "pacchetti").querySelector('[data-pk="etf_settori"]')); await attendi(80);
assert.equal(db.watchlist.filter((w) => w.user_id === "u2").length, prima2 + 11, "pacchetto settori aggiunto");
click(d, $(d, "pacchetti").querySelector('[data-pk="tutto"]')); await attendi(150);
assert.ok(db.watchlist.filter((w) => w.user_id === "u2").length >= 400 && db.watchlist.filter((w) => w.user_id === "u2").length <= 500, "pacchetto TUTTO aggiunto: " + db.watchlist.filter((w) => w.user_id === "u2").length);
assert.equal($(d, "pacchetti").querySelector('[data-pk="tutto"]').disabled, true, "tutto completo");
assert.equal($(d, "pacchetti").querySelector('[data-pk="etf_base"]').disabled, true, "pacchetto gia' completo disattivato");
assert.deepEqual(d.window.errori, []);
// analisi solo del ticker sbagliato: uso rimborsato
d.window.__MA_APP.S.wl = [{ ticker: "ZZZZ", tipo: "azioni" }];
const prima = db.access_keys[0].usi_rimasti;
await d.window.__MA_APP.analizzaLista(["ZZZZ"]);
assert.equal(db.access_keys[0].usi_rimasti, prima, "uso rimborsato su ticker inesistente");
assert.match(testo(d, "risultati"), /Ticker non trovato/);
// rimozione chip
await finche(() => d.window.document.querySelector('[data-del="ZZZZ"]'), "chip ZZZZ");
click(d, d.window.document.querySelector('[data-del="ZZZZ"]')); await attendi(60);
assert.ok(!db.watchlist.some((w) => w.ticker === "ZZZZ"));

// retry su limite minuto
db.watchlist.push({ id: 99, user_id: "u2", ticker: "LENTO", tipo: "azioni" });
await d.window.__MA_APP.analizzaLista(["LENTO"]);
assert.ok(d.window.__MA_APP.S.ris.LENTO, "riprovato dopo 429 al minuto");

// =============== 3) portafoglio ===============
click(d, d.window.document.querySelector('#menu [data-tab="portafoglio"]'));
assert.ok(!$(d, "tab-portafoglio").classList.contains("hidden"));
$(d, "posTicker").value = "AAPL"; $(d, "posQta").value = "3"; $(d, "posPrezzo").value = "500";
invia(d, $(d, "formPos")); await attendi(80);
assert.equal(db.portfolio.length, 1);
assert.match(testo(d, "boxConcentrazione"), /una sola posizione/);
click(d, $(d, "btnAggiornaPf"));
await finche(() => /Completato/.test($(d, "progresso").textContent), "aggiorna portafoglio");
assert.match(testo(d, "boxAllarmi"), /Segnali tecnici di uscita[\s\S]*AAPL/, "allarme uscita");
assert.match(testo(d, "tabellaPf"), /Valuta uscita/);
// ATR stop: acquisto - 2*ATR (non confronta il prezzo con se stesso)
const a = d.window.__MA_APP.S.ris.AAPL;
const pos = { ticker: "AAPL", prezzo_acquisto: a.prezzo + 3 * a.atr14, quantita: 1 };
assert.ok(d.window.__MA_APP.segnaliUscita(pos).motivi.some((m) => /ATR/.test(m)), "stop ATR scatta quando prezzo < acquisto-2*ATR");
const pos2 = { ticker: "AAPL", prezzo_acquisto: a.prezzo + 0.5 * a.atr14, quantita: 1 };
assert.ok(!d.window.__MA_APP.segnaliUscita(pos2).motivi.some((m) => /ATR/.test(m)), "stop ATR non scatta se vicino");
// concentrazione per peso
$(d, "posTicker").value = "MSFT"; $(d, "posQta").value = "1"; $(d, "posPrezzo").value = "10";
invia(d, $(d, "formPos")); await attendi(80);
assert.match(testo(d, "boxConcentrazione"), /AAPL pesa il/);
// rimuovi
click(d, d.window.document.querySelector('[data-delpos="MSFT"]')); await attendi(60);
assert.equal(db.portfolio.length, 1);
// dimensionamento
const dim = d.window.__MA_APP.dimensiona({ prezzo: 100, atr14: 2 });
assert.equal(dim.qta, Math.min(Math.floor(10 / 4), 10));

// =============== 4) impostazioni ===============
$(d, "impSl").value = "5"; $(d, "impTp").value = "10"; invia(d, $(d, "formImp")); await attendi(60);
assert.equal(db.impostazioni_rischio[0].stop_loss, 5); assert.equal(db.impostazioni_rischio[0].take_profit, 10);
$(d, "impSl").value = "999"; invia(d, $(d, "formImp")); await attendi(60);
assert.equal(db.impostazioni_rischio[0].stop_loss, 50, "valori limitati");
$(d, "nuovaPw").value = "nuovapass1"; invia(d, $(d, "formPw")); await attendi(40); assert.equal(ctx.pwCambiata, "nuovapass1");
// =============== 4 bis) affidabilita' ===============
assert.match(testo(d, "risultati"), /Affidabilità storica/, "badge affidabilita nelle schede");
assert.ok(d.window.document.querySelectorAll("#risultati details").length > 0, "dettagli del perche'");
assert.match(testo(d, "risultati"), /Compra e tieni/i);
ctx.mercatoGiu = true; $(d, "impSpread").value = "0.5"; invia(d, $(d, "formImp")); await attendi(60);
assert.equal(db.impostazioni_rischio[0].spread, 0.5, "spread salvato");
d.window.__MA_APP.S.chiave.usi_rimasti = Math.max(d.window.__MA_APP.S.chiave.usi_rimasti, 5); db.access_keys[0].usi_rimasti = Math.max(db.access_keys[0].usi_rimasti, 5);
await d.window.__MA_APP.analizzaLista(["VOO"]);
assert.equal(ctx.chiamate.filter((c) => c.url.endsWith("/analizza")).pop().body.spread, 0.5, "spread inviato al server");
assert.match(testo(d, "risultati"), /Mercato generale \(SPY\) sotto la media a 200 giorni/);
click(d, d.window.document.querySelector('#menu [data-tab="affidabilita"]'));
await finche(() => /appena iniziato/.test(testo(d, "boxTrack")), "registro vuoto");
ctx.track = { chiusi: 40, vinti: 22, persi: 12, scaduti: 6, aperti: 3, rendimento_medio: 1.4, dal: "2026-09-01", brier: 0.2, brier_base: 0.25, calibrazione: [{ da: 40, a: 60, previsto: 52, osservato: 50, n: 20 }] };
ctx.aggregate = [{ tipo: "trend", titoli: 30, vinti: 300, persi: 250, scaduti: 150 }];
click(d, $(d, "btnAggiornaAff")); await finche(() => /Obiettivo raggiunto/.test(testo(d, "boxTrack")), "registro con dati");
assert.match(testo(d, "boxTrack"), /22 \(55%/); assert.match(testo(d, "boxCalib"), /Migliore del riferimento/); assert.match(testo(d, "boxAggregate"), /Trend rialzista[\s\S]*30[\s\S]*700/);
click(d, d.window.document.querySelector('#menu [data-tab="analisi"]'));
// avviso scorte
d.window.__MA_APP.S.chiave.usi_rimasti = 3; d.window.__MA_APP.S.chiave.usi_totali = 150; d.window.__MA_APP.renderStato();
assert.match(testo(d, "boxStato"), /Sta per finire/);
d.window.__MA_APP.S.chiave.usi_rimasti = 100; d.window.__MA_APP.renderStato();
assert.ok(!/Sta per finire/.test(testo(d, "boxStato")));
d.window.__MA_APP.S.chiave.usi_rimasti = db.access_keys[0].usi_rimasti; d.window.__MA_APP.S.chiave.usi_totali = db.access_keys[0].usi_totali;

// avvisi email: consenso registrato
assert.equal(!!db.impostazioni_rischio[0].avvisi_email, false, "avvisi spenti di default");
$(d, "impAvvisi").checked = true; invia(d, $(d, "formImp")); await attendi(60);
assert.equal(db.impostazioni_rischio[0].avvisi_email, true); const consenso = db.impostazioni_rischio[0].avvisi_consenso_il; assert.ok(consenso, "data del consenso registrata");
invia(d, $(d, "formImp")); await attendi(60); assert.equal(db.impostazioni_rischio[0].avvisi_consenso_il, consenso, "il consenso non viene riscritto");
$(d, "impAvvisi").checked = false; invia(d, $(d, "formImp")); await attendi(60); assert.equal(db.impostazioni_rischio[0].avvisi_email, false);

// chiave esaurita / disattivata
db.access_keys[0].stato = "disattivata"; click(d, $(d, "btnRicontrolla") || d.window.document.createElement("b"));
await d.window.eval("0"); 
assert.deepEqual(d.window.errori, [], "nessun errore JS nell'area cliente");
// logout
click(d, $(d, "linkEsci")); await finche(() => !$(d, "vistaAuth").classList.contains("hidden"), "logout");
click(d, $(d, "linkDimenticata")); await attendi(30);
assert.match(testo(d, "authMsg"), /Scrivi la tua email/);
$(d, "loginEmail").value = "n@x.it"; click(d, $(d, "linkDimenticata")); await finche(() => ctx.reset, "reset inviato"); await attendi(30);
assert.equal(ctx.reset.email, "n@x.it"); assert.match(testo(d, "authMsg"), /Se l'email è registrata/);
ctx.emit("PASSWORD_RECOVERY");
assert.ok(!$(d, "vistaRecupero").classList.contains("hidden") && $(d, "vistaAuth").classList.contains("hidden") && $(d, "vistaApp").classList.contains("hidden"), "schermata nuova password");
$(d, "recPw").value = "corta"; invia(d, $(d, "formRecupero")); await attendi(30); assert.match(testo(d, "msgRecupero"), /Minimo 8/);
$(d, "recPw").value = "nuovapass2"; invia(d, $(d, "formRecupero")); await finche(() => $(d, "vistaRecupero").classList.contains("hidden"), "recupero completato");
assert.equal(ctx.pwCambiata, "nuovapass2");
assert.deepEqual(d.window.errori, [], "nessun errore JS dopo logout/recupero");

// =============== 5) pannello admin ===============
const db2 = nuovoDb(), ctx2 = { utenti: [{ id: "adm", email: "a@x.it", password: "p" }, { id: "c1", email: "c1@x.it", password: "p" }], chiamate: [], session: { access_token: "tok-adm", user: { id: "adm", email: "a@x.it" } } };
db2.admins.push({ user_id: "adm" });
db2.profiles.push({ user_id: "adm", username: "boss", email: "a@x.it", created_at: "2026-01-01T00:00:00Z" },
  { user_id: "c1", username: "cliente1", email: "<img src=x onerror=alert(1)>@x.it", created_at: "2026-02-01T00:00:00Z" },
  { user_id: "c2", username: "cliente2", email: "c2@x.it", created_at: "2026-02-02T00:00:00Z" },
  { user_id: "c3", username: "cliente3", email: "c3@x.it", created_at: "2026-02-03T00:00:00Z" });
db2.access_keys.push({ id: 2, user_id: "c3", codice: "MA-LOW1-LOW1-LOW1", stato: "attiva", usi_totali: 150, usi_rimasti: 4, scade_il: null, ultimo_uso_il: null, note: null });
db2.access_keys.push({ id: 1, user_id: "c2", codice: "MA-OLD1-OLD1-OLD1", stato: "attiva", usi_totali: 150, usi_rimasti: 40, scade_il: null, ultimo_uso_il: "2026-10-01T10:00:00Z", note: "Base" });
let ad = await carica("admin.html", { db: db2, ctx: ctx2 });
await finche(() => !$(ad, "pannello").classList.contains("hidden"), "pannello admin");
assert.equal(ad.window.document.querySelectorAll("#tabella tbody tr").length, 4);
assert.match(testo(ad, "stats"), /In esaurimento[^0-9]*1/); assert.match(testo(ad, "stats"), /avvisi email attivi\s*2/); assert.match(testo(ad, "stats"), /inviate \(7 giorni\)\s*5/);
$(ad, "filtro").value = "esaurimento"; $(ad, "filtro").dispatchEvent(new ad.window.Event("change"));
assert.equal(ad.window.document.querySelectorAll("#tabella tbody tr").length, 1); assert.match(testo(ad, "tabella"), /cliente3/);
$(ad, "filtro").value = ""; $(ad, "filtro").dispatchEvent(new ad.window.Event("change"));
assert.ok(!ad.window.document.querySelector("#tabella img"), "email escapata (no XSS)");
assert.match(testo(ad, "tabella"), /Da abilitare/); assert.match(testo(ad, "tabella"), /40 \/ 150/); assert.match(testo(ad, "tabella"), /MA-OLD1-OLD1-OLD1/);
// preset piano + crea chiave
click(ad, ad.window.document.querySelector('[data-piano="1"]'));
assert.equal($(ad, "kUsi").value, "150"); assert.equal($(ad, "kGiorni").value, "30");
$(ad, "kUser").value = "cliente1"; invia(ad, $(ad, "formChiave"));
await finche(() => /abilitato/.test($(ad, "msgCrea").textContent), "chiave creata");
assert.match(testo(ad, "esitoCrea"), /MA-TEST-TEST-TEST/);
assert.equal(db2.access_keys.find((k) => k.user_id === "c1").usi_totali, 150);
await finche(() => /Attiva/.test(testo(ad, "tabella")), "tabella aggiornata");
// utente inesistente
$(ad, "kUser").value = "nessuno"; $(ad, "kUsi").value = "5"; invia(ad, $(ad, "formChiave"));
await finche(() => /non trovato/i.test($(ad, "msgCrea").textContent), "errore utente");
// disattiva
click(ad, ad.window.document.querySelector('[data-az="stato"][data-s="disattivata"]'));
await finche(() => /Disattivata/.test(testo(ad, "tabella")), "disattivata");
// filtro
$(ad, "filtro").value = "senza"; $(ad, "filtro").dispatchEvent(new ad.window.Event("change"));
assert.equal(ad.window.document.querySelectorAll("#tabella tbody tr").length, 0 + (db2.profiles.filter((p) => !db2.access_keys.some((k) => k.user_id === p.user_id)).length));
assert.deepEqual(ad.window.errori, []);
// non admin
const ctx3 = { utenti: [], chiamate: [], session: { access_token: "tok-c1", user: { id: "c1", email: "c1@x.it" } } };
const ad2 = await carica("admin.html", { db: db2, ctx: ctx3 });
await finche(() => !$(ad2, "msgAccesso").classList.contains("hidden"), "accesso negato");
assert.ok($(ad2, "pannello").classList.contains("hidden"));
// non loggato
const ad3 = await carica("admin.html", { db: db2, ctx: { utenti: [], chiamate: [], session: null } });
await finche(() => /Devi accedere/.test($(ad3, "msgAccesso").textContent), "richiede login");

// =============== 6) pagine statiche ===============
for (const f of ["termini.html", "privacy.html", "istruzioni.html", "metodo.html"]) {
  let h = leggi(f).replace('<script src="config.js"></script>', "<script>" + leggi("config.js") + "</script>");
  const dm = new JSDOM(h, { runScripts: "dangerously" });
  await attendi(10);
  assert.equal(dm.window.document.querySelectorAll("[data-cfg]").length > 0, true, f);
  assert.ok(dm.window.document.querySelector('[data-cfg]').textContent.length > 3, f + " compilato");
}
{
  const dm = new JSDOM(leggi("istruzioni.html").replace('<script src="config.js"></script>', "<script>" + leggi("config.js") + "</script>"), { runScripts: "dangerously" });
  assert.match(dm.window.document.getElementById("piani").textContent, /Base[\s\S]*150[\s\S]*5,90/);
}
// =============== 6 bis) disiscrizione ===============
{
  const TOK = "123e4567-e89b-12d3-a456-426614174000", chiam = [];
  const mk = async (url, risposta) => {
    const html = leggi("disiscrizione.html").replace('<script src="config.js"></script>', "<script>" + leggi("config.js").replace("INSERISCI_URL_PROGETTO_SUPABASE", "https://prova.supabase.co").replace("INSERISCI_ANON_KEY_SUPABASE", "k".repeat(40)) + "</script>");
    const dm = new JSDOM(html, { runScripts: "dangerously", url, beforeParse(w) { w.fetch = async (u, i) => { chiam.push({ u, i }); return { json: async () => risposta }; }; } });
    await attendi(20); return dm;
  };
  let dm = await mk("https://s.it/disiscrizione.html?t=" + TOK, { ok: true });
  dm.window.document.getElementById("btn").click(); await attendi(40);
  assert.equal(chiam.length, 1); assert.match(chiam[0].u, /\/functions\/v1\/disiscrivi\?t=123e4567/); assert.equal(chiam[0].i.method, "POST");
  assert.match(dm.window.document.getElementById("msg").textContent, /non riceverai più avvisi/);
  dm = await mk("https://s.it/disiscrizione.html?t=" + TOK, { ok: false, errore: "Link non valido o già usato." });
  dm.window.document.getElementById("btn").click(); await attendi(40);
  assert.match(dm.window.document.getElementById("msg").textContent, /già usato/);
  dm = await mk("https://s.it/disiscrizione.html?t=zzz", {}); assert.equal(dm.window.document.getElementById("btn").disabled, true);
  dm = await mk("https://s.it/disiscrizione.html", {}); assert.equal(dm.window.document.getElementById("btn").disabled, true);
}

// =============== 7) PWA ===============
import { existsSync } from "node:fs";
const man = JSON.parse(leggi("manifest.webmanifest"));
assert.equal(man.display, "standalone"); assert.ok(man.icons.length >= 3);
for (const ic of man.icons) assert.ok(existsSync(P + ic.src), "icona mancante " + ic.src);
new Function(leggi("sw.js").replace(/self\./g, "globalThis.")); // sintassi valida
assert.match(leggi("index.html"), /rel="manifest"/);
assert.match(testo(await carica("index.html", { db: nuovoDb(), ctx: { utenti: [], chiamate: [], session: null } }), "vistaAuth"), /Password dimenticata/);
console.log("test_frontend OK");
