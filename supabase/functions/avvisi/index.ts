// =========================================================================
// EDGE FUNCTION: avvisi
// Chiamata ogni giorno da uno scheduler (dopo la chiusura dei mercati USA).
// Controlla le posizioni dei clienti che hanno dato il consenso e invia UNA email
// con i segnali tecnici di uscita nuovi. Protetta da un segreto (CRON_SECRET):
// va pubblicata con --no-verify-jwt.
//   Corpo opzionale:  {"prova": true}            -> calcola ma non invia nulla
//                     {"test_a": "me@mail.it"}   -> invia un'email di prova
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { risposta } from "../_shared/http.ts";
import { creaDati, ErroreServizio } from "../_shared/dati.ts";
import { costruisciEmail, eseguiAvvisi } from "../_shared/avvisi.ts";
import type { Deps } from "../_shared/avvisi.ts";
import { inviaEmail } from "../_shared/email.ts";
import { jobInRitardo, testoReport } from "../_shared/sorveglianza.ts";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const { datiTitolo } = creaDati(sb, {
  tdKey: env("TWELVEDATA_API_KEY"), cacheOre: Number(env("CACHE_ORE", "20")), storicoGiorni: Number(env("STORICO_GIORNI", "5000")),
});

function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// I dati valgono solo se scaricati dopo le 21:10 UTC (la borsa USA chiude alle 20:00 o 21:00 UTC):
// cosi' gli avvisi usano la chiusura definitiva e non un prezzo di meta' giornata.
function chiusuraDefinitiva(adesso = new Date()): Date {
  const c = new Date(Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth(), adesso.getUTCDate(), 21, 10, 0));
  if (c.getTime() > adesso.getTime()) c.setUTCDate(c.getUTCDate() - 1);
  return c;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return risposta({ ok: false, errore: "Metodo non consentito" }, 405);
  const segreto = env("CRON_SECRET");
  if (segreto.length < 16) return risposta({ ok: false, errore: "CRON_SECRET non configurato (almeno 16 caratteri)." }, 500);
  if (!uguali(req.headers.get("x-cron-secret") || "", segreto)) return risposta({ ok: false, errore: "Non autorizzato" }, 401);

  const mailCfg = { provider: env("MAIL_PROVIDER", "resend").toLowerCase(), apiKey: env("RESEND_API_KEY") || env("BREVO_API_KEY"), da: env("MAIL_FROM") };
  if (mailCfg.provider === "brevo") mailCfg.apiKey = env("BREVO_API_KEY");
  if (mailCfg.provider === "resend") mailCfg.apiKey = env("RESEND_API_KEY");
  const urlSito = env("SITE_URL").replace(/\/$/, "");
  if (!urlSito || !mailCfg.apiKey || !mailCfg.da) {
    return risposta({ ok: false, errore: "Configurazione email incompleta: servono SITE_URL, MAIL_FROM e la chiave del servizio email." }, 500);
  }
  const nome = env("NOME_SERVIZIO", "Tickly");

  let body: any = {};
  try { body = await req.json(); } catch (_e) { /* vuoto */ }

  // Email di prova per verificare servizio, mittente e consegna
  if (body.test_a) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.test_a))) return risposta({ ok: false, errore: "Indirizzo non valido" }, 400);
    const m = costruisciEmail({
      username: "prova", nomeServizio: nome, urlSito, urlDisiscrizione: urlSito + "/disiscrizione.html?t=prova",
      voci: [{ ticker: "ESEMPIO", prezzo: 92, acquisto: 100, variazione: -8, segnali: [{ codice: "stop_pct", testo: "stop-loss dell'8% raggiunto (email di prova)" }] }],
    });
    try {
      await inviaEmail(mailCfg, { a: String(body.test_a), oggetto: "[PROVA] " + m.oggetto, testo: m.testo, html: m.html });
      return risposta({ ok: true, inviata: true });
    } catch (e) {
      return risposta({ ok: false, errore: String((e as Error).message) }, 502);
    }
  }

  const prova = body.prova === true;

  // Sorveglianza per l'amministratore (solo se ADMIN_EMAIL e' impostata): job notturno fermo, report mensile
  const adminMail = env("ADMIN_EMAIL");
  if (adminMail && !prova) {
    try {
      const adesso = new Date();
      const { data: ss } = await sb.rpc("stato_servizio");
      if (jobInRitardo(ss && ss.ultima_run ? ss.ultima_run.quando : null, adesso)) {
        await sb.rpc("scrivi_log", { p_livello: "errore", p_componente: "sorveglianza", p_messaggio: "Il caricamento notturno dei dati non gira da oltre 30 ore" });
        await inviaEmail(mailCfg, { a: adminMail, oggetto: "[" + nome + "] ATTENZIONE: aggiornamento dati fermo", testo: "Il caricamento notturno dei prezzi non risulta eseguito da oltre 30 ore. Controlla le funzioni e la chiave Twelve Data (vedi pagina Stato del servizio).", html: "<p>Il caricamento notturno dei prezzi non risulta eseguito da oltre 30 ore. Controlla le funzioni e la chiave Twelve Data (vedi pagina Stato del servizio).</p>" });
      }
      if (adesso.getUTCDate() === 1) {
        const mese = new Date(Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
        const { data: righe } = await sb.rpc("report_mensile", { p_mese: mese + "-01" });
        const { data: decl } = await sb.from("modelli_declassati").select("modello, orizzonte");
        const t = testoReport(righe || [], mese, decl || []);
        await inviaEmail(mailCfg, { a: adminMail, oggetto: t.oggetto, testo: t.testo, html: "<pre style=\"font-family:inherit;white-space:pre-wrap\">" + t.testo.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</pre>" });
      }
    } catch (_e) { /* la sorveglianza non deve bloccare gli avvisi ai clienti */ }
  }
  const deps: Deps = {
    destinatari: async () => { const { data } = await sb.rpc("avvisi_destinatari"); return data || []; },
    recenti: async () => { const { data } = await sb.rpc("avvisi_recenti"); return data || []; },
    dati: async (t, consenti) => {
      try { const r = await datiTitolo(t, !consenti, chiusuraDefinitiva()); return { barre: r.barre, scaricato: r.scaricato }; }
      catch (e) { if (e instanceof ErroreServizio) return null; throw e; }
    },
    invia: async (m) => { if (!prova) await inviaEmail(mailCfg, m); },
    registra: async (userId, ticker, motivi) => {
      if (prova) return;
      const { error } = await sb.from("avvisi_inviati").insert(motivi.map((motivo) => ({ user_id: userId, ticker, motivo })));
      if (error) throw new Error("registro");
    },
    attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
    oggi: () => new Date(),
  };
  try {
    const riepilogo = await eseguiAvvisi(deps, {
      urlSito, urlDisiscrizionePagina: urlSito + "/disiscrizione.html",
      urlOneClickBase: env("SUPABASE_URL") + "/functions/v1/disiscrivi",
      nomeServizio: nome, maxScarichi: Number(env("MAX_SCARICHI", "10")), pausaMs: Number(env("PAUSA_MS", "7700")),
    });
    return risposta({ ok: true, prova, ...riepilogo });
  } catch (_e) {
    return risposta({ ok: false, errore: "Errore durante il controllo degli avvisi." }, 500);
  }
});
