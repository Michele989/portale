// =========================================================================
// EDGE FUNCTION: analizza
// Analizza UN ticker per il cliente autenticato e scala 1 uso dalla sua chiave.
// La chiave Twelve Data resta qui sul server (secret), mai nel browser.
// Se i dati non si possono ottenere, l'uso viene rimborsato.
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { opzioniCors, risposta, tokenDa } from "../_shared/http.ts";
import { analizzaSerie, limita, statisticheStandard, statoMercato, valutaSegnale } from "../_shared/analisi.ts";
import { creaDati, ErroreServizio } from "../_shared/dati.ts";
import { leggiGruppo } from "../_shared/gruppo.ts";
import { analizzaOrizzonti, applicaDeclassamenti } from "../_shared/orizzonti.ts";
import { mercatoDebole } from "../_shared/provider.ts";
import type { Barra } from "../_shared/analisi.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const TD_KEY = Deno.env.get("TWELVEDATA_API_KEY") ?? "";
const NOMI_GRUPPO: Record<string, string> = { etf: "ETF", crescita: "Crescita", azioni: "Azioni" };
const CACHE_ORE = Number(Deno.env.get("CACHE_ORE") ?? "20");
const STORICO_GIORNI = Number(Deno.env.get("STORICO_GIORNI") ?? "5000");

const { datiTitolo } = creaDati(sb, { tdKey: TD_KEY, cacheOre: CACHE_ORE, storicoGiorni: STORICO_GIORNI });

// Registro dei segnali reali e conteggi per le statistiche aggregate (errori ignorati).
async function registra(ticker: string, barre: Barra[], a: any): Promise<void> {
  try {
    if (a.qualita && a.qualita.gravi) return; // dati dubbi: nulla viene registrato
    const st = statisticheStandard(barre);
    const ora = new Date().toISOString();
    await sb.from("backtest_ticker").upsert([
      { ticker, tipo: "trend", vinti: st.trend.vinti, persi: st.trend.persi, scaduti: st.trend.scaduti, aggiornato_il: ora },
      { ticker, tipo: "ribasso", vinti: st.ribasso.vinti, persi: st.ribasso.persi, scaduti: st.ribasso.scaduti, aggiornato_il: ora },
    ], { onConflict: "ticker,tipo" });
    const { data: aperti } = await sb.from("segnali").select("id, data_segnale").eq("ticker", ticker).is("esito", null);
    for (const sg of aperti || []) {
      const r = valutaSegnale(barre, sg.data_segnale);
      if (r) await sb.from("segnali").update({ esito: r.esito, data_esito: r.data_esito, giorni: r.giorni, rendimento: r.rendimento }).eq("id", sg.id);
    }
    if (a.stato === "forte" || a.stato === "ipervenduto") {
      const tipo = a.stato === "forte" ? "trend" : "ribasso";
      const stat = tipo === "trend" ? st.trend : st.ribasso;
      await sb.from("segnali").upsert(
        { ticker, tipo, data_segnale: a.ultima, prezzo: a.prezzo, p_prevista: stat.n >= 10 ? stat.pct : null, n_storico: stat.n },
        { onConflict: "ticker,tipo,data_segnale", ignoreDuplicates: true },
      );
    }
  } catch (_e) { /* il registro non deve mai far fallire l'analisi */ }
}

Deno.serve(async (req: Request) => {
  const cors = opzioniCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return risposta({ ok: false, codice: "METODO", errore: "Metodo non consentito" }, 405);

  const { data: ut, error: errAuth } = await sb.auth.getUser(tokenDa(req));
  if (errAuth || !ut || !ut.user) return risposta({ ok: false, codice: "NON_AUTENTICATO", errore: "Sessione scaduta: accedi di nuovo." }, 401);
  const userId = ut.user.id;

  let body: any = {};
  try { body = await req.json(); } catch (_e) { /* body vuoto */ }
  const ticker = String(body.ticker || "").trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) return risposta({ ok: false, codice: "TICKER_NON_VALIDO", errore: "Ticker non valido." }, 400);
  const opz = {
    tp: limita(body.tp, 1, 100, 8),
    sl: limita(body.sl, 1, 50, 8),
    comm: limita(body.comm, 0, 5, 0.2),
    spread: limita(body.spread, 0, 5, 0.1),
  };

  // 1) Controllo chiave (messaggi chiari) e consumo atomico di 1 uso
  const { data: chiave } = await sb.from("access_keys").select("stato, usi_rimasti, scade_il")
    .eq("user_id", userId).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!chiave) return risposta({ ok: false, codice: "NESSUNA_CHIAVE", errore: "Accesso non ancora abilitato: comunica il tuo username all'amministratore." }, 403);
  if (chiave.stato !== "attiva") return risposta({ ok: false, codice: "DISATTIVATA", errore: "La tua chiave e' disattivata. Contatta l'amministratore." }, 403);
  if (chiave.scade_il && new Date(chiave.scade_il).getTime() <= Date.now()) return risposta({ ok: false, codice: "SCADUTA", errore: "La tua chiave e' scaduta. Contatta l'amministratore per rinnovarla." }, 403);
  
  // limite di velocita': massimo 30 analisi al minuto per utente (protegge il servizio dati)
  const { data: okLimite } = await sb.rpc("controlla_limite", { p_chiave: "analizza:" + userId, p_max: 30, p_secondi: 60 });
  if (okLimite === false) return risposta({ ok: false, codice: "TROPPE_RICHIESTE", errore: "Troppe richieste ravvicinate: attendi un minuto e riprova." }, 429);

  // 2) Dati: con usi esauriti si usa solo la copia salvata (nessun download a nostro carico)
  let consumato = false, dataBarra = "";
  try {
    const esauriti = chiave.usi_rimasti <= 0;
    let r;
    try { r = await datiTitolo(ticker, esauriti); }
    catch (e) { if (esauriti && e instanceof ErroreServizio && e.codice === "NON_IN_CACHE") return risposta({ ok: false, codice: "USI_ESAURITI", errore: "Hai esaurito gli usi. Contatta l'amministratore per ricaricare." }, 403); throw e; }
    const { barre, aggiornato } = r;
    dataBarra = barre[0] ? barre[0].d : "";
    // 3) Uso: stesso titolo + stessa data dell'ultima barra + stesso utente = gia' pagata, nessun uso scalato
    const { data: cons, error: errUso } = await sb.rpc("consuma_analisi", { p_user: userId, p_ticker: ticker, p_data: dataBarra });
    if (errUso || !cons || cons.usi < 0) return risposta({ ok: false, codice: "USI_ESAURITI", errore: "Nessun uso disponibile." }, 403);
    const rimasti = cons.usi as number; consumato = !cons.riuso;
    // Filtro di mercato: indice generale (SPY). Se non disponibile, l'analisi prosegue senza.
    let mercato = null, regime = false;
    if (ticker !== "SPY") {
      try { const spy = (await datiTitolo("SPY", esauriti)).barre; mercato = statoMercato(spy, "SPY"); regime = mercatoDebole(spy); } catch (_e) { mercato = null; }
    } else { regime = mercatoDebole(barre); }
    const analisi = analizzaSerie(barre, opz, { mercato: ticker === "SPY" ? statoMercato(barre, "SPY") : mercato });
    if (!analisi) throw new ErroreServizio(404, "DATI_INSUFFICIENTI", "Storico insufficiente per " + ticker);
    await registra(ticker, barre, analisi); // registro segnali e statistiche: non blocca mai l'analisi
    // Studio per orizzonte (breve/medio/lungo): un eventuale errore non blocca mai l'analisi
    let orizzonti = null;
    try {
      const { gruppo, dati } = await leggiGruppo(sb, ticker, barre);
      orizzonti = analizzaOrizzonti(barre.slice().reverse(), { datiOk: !analisi.qualita.gravi, gruppo: dati, nomeGruppo: NOMI_GRUPPO[gruppo] || gruppo, regimeSfavorevole: regime, datiIncerti: !!r.incerti });
      const { data: decl } = await sb.from("modelli_declassati").select("modello, orizzonte");
      if (orizzonti && decl && decl.length) orizzonti = applicaDeclassamenti(orizzonti, decl);
    } catch (_e) { orizzonti = null; }
    return risposta({ ok: true, ticker, ...analisi, orizzonti, dati_del: aggiornato, usi_rimasti: rimasti, riuso: !consumato, usi_risparmiati: cons.risparmiati ?? 0, regime_debole: regime, versione_modello: orizzonti ? orizzonti.breve.versione : null });
  } catch (e) {
    let usi = chiave.usi_rimasti;
    if (consumato) {
      const { data: ripristinati } = await sb.rpc("annulla_analisi", { p_user: userId, p_ticker: ticker, p_data: dataBarra });
      usi = typeof ripristinati === "number" && ripristinati >= 0 ? ripristinati : chiave.usi_rimasti;
    }
    if (e instanceof ErroreServizio) {
      return risposta({ ok: false, codice: e.codice, errore: e.message, usi_rimasti: usi, ...e.extra }, e.stato);
    }
    return risposta({ ok: false, codice: "ERRORE_INTERNO", errore: "Errore imprevisto, uso rimborsato.", usi_rimasti: usi }, 500);
  }
});
