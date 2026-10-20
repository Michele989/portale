import assert from "node:assert/strict";
import * as V from "../supabase/functions/_shared/avvisi.ts";
import { inviaEmail } from "../supabase/functions/_shared/email.ts";

function serie(n, seed, drift = 0.0004, vol = 0.02) {
  let s = seed, p = 100; const cron = [];
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < n; i++) {
    const c = p * (1 + (rnd() - 0.5) * vol + drift);
    cron.push({ d: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), h: Math.max(p, c) * 1.004, l: Math.min(p, c) * 0.996, c, v: 1e6 });
    p = c;
  }
  return cron.reverse(); // piu' recente per primo
}
const imp = { stop_loss: 8, take_profit: 8, commissione: 0.2 };

// ---- regole di uscita ----
const pos = (acq) => ({ ticker: "AAA", quantita: 1, prezzo_acquisto: acq });
assert.deepEqual(V.segnaliUscita(pos(100), 100, 2, imp).map((s) => s.codice), []);
assert.deepEqual(V.segnaliUscita(pos(100), 91.9, null, imp).map((s) => s.codice), ["stop_pct"]);
assert.deepEqual(V.segnaliUscita(pos(100), 95, 3, imp).map((s) => s.codice), [], "ATR: 100-2*3=94 -> 95 non scatta");
assert.deepEqual(V.segnaliUscita(pos(100), 93.9, 3, imp).map((s) => s.codice), ["stop_atr"]);
assert.deepEqual(V.segnaliUscita(pos(100), 90, 3, imp).map((s) => s.codice), ["stop_pct", "stop_atr"]);
assert.deepEqual(V.segnaliUscita(pos(100), 108.4, 2, imp).map((s) => s.codice), ["obiettivo"]);
assert.deepEqual(V.segnaliUscita(pos(100), 108.3, 2, imp).map((s) => s.codice), []);
assert.deepEqual(V.segnaliUscita(pos(0), 50, 1, imp), []);

// ---- testo email ----
const m = V.costruisciEmail({
  username: "<script>x</script>", nomeServizio: "Monitor", urlSito: "https://s.it", urlDisiscrizione: "https://s.it/disiscrizione.html?t=abc",
  voci: [{ ticker: "AAA", prezzo: 91.5, acquisto: 100, variazione: -8.5, segnali: [{ codice: "stop_pct", testo: "stop-loss del 8,0% raggiunto" }] }],
});
assert.match(m.oggetto, /Segnale tecnico di uscita: AAA/);
assert.ok(!m.html.includes("<script>"), "html escapato"); assert.ok(m.html.includes("&lt;script&gt;"));
assert.match(m.testo, /non un consiglio personalizzato/); assert.match(m.testo, /disiscrizione\.html\?t=abc/); assert.match(m.html, /Disattivali qui/);
assert.match(m.testo, /91,50/); assert.match(m.testo, /-8,5%/);
assert.match(V.costruisciEmail({ username: "u", nomeServizio: "M", urlSito: "x", urlDisiscrizione: "y", voci: Array.from({ length: 6 }, (_, i) => ({ ticker: "T" + i, prezzo: 1, acquisto: 1, variazione: 0, segnali: [{ codice: "stop_pct", testo: "a" }] })) }).oggetto, /e altri/);

// ---- orchestrazione con dipendenze finte ----
const OGGI = new Date("2026-03-02T22:30:00Z");
const barre = { AAA: serie(400, 5), BBB: serie(400, 9), VECCHIO: serie(400, 3).map((x) => ({ ...x, d: x.d })) };
const ultima = (t) => barre[t][0].d; // 2026-02-... 
// ultima data della serie: 2025-01-01 + 399 giorni = 2026-02-04 -> 26 giorni prima di OGGI: troppo vecchia. Uso data odierna fittizia coerente:
const ADESSO = new Date(ultima("AAA") + "T22:30:00Z");
const prezzoAAA = barre.AAA[0].c;
const dest = (id, nome, acq, extra = {}) => ({ user_id: id, username: nome, email: nome + "@x.it", token: "tok-" + id, stop_loss: 8, take_profit: 8, commissione: 0.2, posizioni: [{ ticker: "AAA", quantita: 1, prezzo_acquisto: acq }], ...extra });
function creaDeps({ destinatari, recenti = [], scarica = {}, mailFallisce = false, scaricatiOltre = false }) {
  const stato = { mail: [], reg: [], recenti: recenti.slice(), richieste: [], attese: 0 };
  const deps = {
    destinatari: async () => destinatari,
    recenti: async () => stato.recenti,
    dati: async (t, consenti) => {
      stato.richieste.push([t, consenti]);
      if (!barre[t]) return null;
      if (scarica[t]) { if (!consenti) return null; return { barre: barre[t], scaricato: true }; }
      return { barre: barre[t], scaricato: false };
    },
    invia: async (x) => { if (mailFallisce) throw new Error("rifiutata"); stato.mail.push(x); },
    registra: async (u, t, motivi) => { motivi.forEach((mo) => stato.recenti.push({ user_id: u, ticker: t, motivo: mo })); stato.reg.push([u, t, motivi]); },
    attendi: async () => { stato.attese++; },
    oggi: () => ADESSO,
  };
  return { deps, stato };
}
const cfg = { urlSito: "https://s.it", urlDisiscrizionePagina: "https://s.it/disiscrizione.html", urlOneClickBase: "https://p.supabase.co/functions/v1/disiscrivi", nomeServizio: "Monitor", maxScarichi: 2, pausaMs: 10 };

// stop% scatta per chi ha acquistato a prezzo molto piu' alto; nessun segnale per chi ha comprato basso (ma sotto obiettivo? no: sopra obiettivo)
{
  const { deps, stato } = creaDeps({ destinatari: [dest("u1", "ana", prezzoAAA * 1.2), dest("u2", "bob", prezzoAAA * 1.0)] });
  const r = await V.eseguiAvvisi(deps, cfg);
  assert.equal(r.mail_inviate, 1); assert.equal(stato.mail[0].a, "ana@x.it");
  assert.match(stato.mail[0].urlOneClick, /disiscrivi\?t=tok-u1/); assert.match(stato.mail[0].testo, /disiscrizione\.html\?t=tok-u1/);
  assert.deepEqual(r.titoli, 1); assert.equal(r.destinatari, 2);
  assert.ok(stato.reg.length === 1 && stato.reg[0][2].includes("stop_pct"));
  // seconda esecuzione: niente duplicati
  const r2 = await V.eseguiAvvisi(deps, cfg); assert.equal(r2.mail_inviate, 0); assert.equal(stato.mail.length, 1, "nessun doppione");
}
// obiettivo raggiunto
{ const { deps, stato } = creaDeps({ destinatari: [dest("u3", "carla", prezzoAAA / 1.2)] });
  const r = await V.eseguiAvvisi(deps, cfg); assert.equal(r.mail_inviate, 1); assert.match(stato.mail[0].testo, /obiettivo/); }
// invio fallito: non registrato, ritenta alla prossima
{ const { deps, stato } = creaDeps({ destinatari: [dest("u1", "ana", prezzoAAA * 1.2)], mailFallisce: true });
  const r = await V.eseguiAvvisi(deps, cfg); assert.equal(r.errori_invio, 1); assert.equal(r.mail_inviate, 0); assert.equal(stato.reg.length, 0); }
// una sola mail per utente anche con piu' titoli
{ const d = dest("u1", "ana", prezzoAAA * 1.2); d.posizioni.push({ ticker: "BBB", quantita: 1, prezzo_acquisto: barre.BBB[0].c * 1.3 });
  const { deps, stato } = creaDeps({ destinatari: [d] }); const r = await V.eseguiAvvisi(deps, cfg);
  assert.equal(stato.mail.length, 1); assert.deepEqual(r.invii[0].titoli, ["AAA", "BBB"]); }
// motivo nuovo dopo un avviso gia' inviato: parte solo il nuovo
{ const d = dest("u1", "ana", prezzoAAA * 1.2); // stop_pct (e forse stop_atr)
  const { deps, stato } = creaDeps({ destinatari: [d], recenti: [{ user_id: "u1", ticker: "AAA", motivo: "stop_pct" }] });
  const r = await V.eseguiAvvisi(deps, cfg);
  if (r.mail_inviate) assert.ok(!/stop-loss del/.test(stato.mail[0].testo), "non ripete lo stop gia' avvisato"); }
// limite di scarichi: i titoli oltre il limite vengono rimandati
{ const d = dest("u1", "ana", prezzoAAA * 1.2);
  const t = ["AAA", "BBB", "CCC", "DDD"]; d.posizioni = t.map((x) => ({ ticker: x, quantita: 1, prezzo_acquisto: 1000 }));
  barre.CCC = serie(400, 11); barre.DDD = serie(400, 13);
  const { deps, stato } = creaDeps({ destinatari: [d], scarica: { AAA: 1, BBB: 1, CCC: 1, DDD: 1 } });
  const r = await V.eseguiAvvisi(deps, { ...cfg, maxScarichi: 2 });
  assert.equal(r.scaricati, 2); assert.deepEqual(r.rimandati, ["CCC", "DDD"]); assert.equal(stato.attese, 2, "pausa solo dopo ogni scarico");
  assert.deepEqual(stato.richieste.map((x) => x[1]), [true, true, false, false]); }
// dati vecchi o anomali: nessun avviso
{ const vecchi = barre.AAA.map((x) => x); const d = dest("u1", "ana", prezzoAAA * 1.2);
  const { deps, stato } = creaDeps({ destinatari: [d] }); deps.oggi = () => new Date(ADESSO.getTime() + 9 * 864e5);
  const r = await V.eseguiAvvisi(deps, cfg); assert.deepEqual(r.dati_scartati, ["AAA"]); assert.equal(stato.mail.length, 0);
  const anom = barre.AAA.map((x) => ({ ...x })); anom[50].c *= 0.3; anom[50].h *= 0.3; anom[50].l *= 0.3; barre.ANOM = anom;
  const d2 = dest("u9", "zed", 1000); d2.posizioni = [{ ticker: "ANOM", quantita: 1, prezzo_acquisto: 1000 }];
  const k = creaDeps({ destinatari: [d2] }); const r2 = await V.eseguiAvvisi(k.deps, cfg); assert.deepEqual(r2.dati_scartati, ["ANOM"]); assert.equal(k.stato.mail.length, 0); }
// ticker sconosciuto: rimandato, nessun crash
{ const d = dest("u1", "ana", 100); d.posizioni = [{ ticker: "ZZZ", quantita: 1, prezzo_acquisto: 100 }];
  const { deps } = creaDeps({ destinatari: [d] }); const r = await V.eseguiAvvisi(deps, cfg); assert.deepEqual(r.rimandati, ["ZZZ"]); assert.equal(r.mail_inviate, 0); }
// nessun destinatario
{ const { deps } = creaDeps({ destinatari: [] }); const r = await V.eseguiAvvisi(deps, cfg); assert.equal(r.destinatari, 0); assert.equal(r.mail_inviate, 0); }

// ---- invio email: Resend e Brevo ----
const chiamate = [];
const finto = (status = 200) => async (url, init) => { chiamate.push({ url, init, body: JSON.parse(init.body) }); return { ok: status < 300, status }; };
const mail = { a: "cli@x.it", oggetto: "Ogg", testo: "T", html: "<b>H</b>", urlOneClick: "https://p/disiscrivi?t=1" };
await inviaEmail({ provider: "resend", apiKey: "re_KEY", da: "Monitor <avvisi@dominio.it>" }, mail, finto());
let c = chiamate.pop();
assert.equal(c.url, "https://api.resend.com/emails"); assert.equal(c.init.headers.Authorization, "Bearer re_KEY");
assert.deepEqual(c.body.to, ["cli@x.it"]); assert.equal(c.body.from, "Monitor <avvisi@dominio.it>"); assert.equal(c.body.headers["List-Unsubscribe"], "<https://p/disiscrivi?t=1>"); assert.equal(c.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
await inviaEmail({ provider: "brevo", apiKey: "xkey", da: "Monitor <avvisi@dominio.it>" }, mail, finto());
c = chiamate.pop();
assert.equal(c.url, "https://api.brevo.com/v3/smtp/email"); assert.equal(c.init.headers["api-key"], "xkey");
assert.deepEqual(c.body.sender, { name: "Monitor", email: "avvisi@dominio.it" }); assert.deepEqual(c.body.to, [{ email: "cli@x.it" }]); assert.equal(c.body.htmlContent, "<b>H</b>");
await inviaEmail({ provider: "brevo", apiKey: "xkey", da: "solo@mail.it" }, { ...mail, urlOneClick: undefined }, finto());
c = chiamate.pop(); assert.deepEqual(c.body.sender, { email: "solo@mail.it" }); assert.deepEqual(c.body.headers, {});
await assert.rejects(inviaEmail({ provider: "resend", apiKey: "re_KEY", da: "a@b.it" }, mail, finto(403)), /HTTP 403/);
await assert.rejects(inviaEmail({ provider: "resend", apiKey: "", da: "a@b.it" }, mail, finto()), /non configurata/);
await assert.rejects(inviaEmail({ provider: "boh", apiKey: "k", da: "a@b.it" }, mail, finto()), /non valido/);
try { await inviaEmail({ provider: "resend", apiKey: "SEGRETISSIMA", da: "a@b.it" }, mail, finto(500)); } catch (e) { assert.ok(!String(e.message).includes("SEGRETISSIMA"), "la chiave non finisce negli errori"); }
console.log("test_avvisi OK");
