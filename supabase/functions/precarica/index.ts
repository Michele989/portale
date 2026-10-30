// =========================================================================
// EDGE FUNCTION: precarica
// Chiamata ogni pochi minuti, di notte, da pg_cron (vedi cron_precarica.sql).
// Scarica i prezzi dei titoli seguiti dai clienti che non sono ancora aggiornati.
// Protetta da PRECARICA_SECRET: va pubblicata con --no-verify-jwt.
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { risposta } from "../_shared/http.ts";
import { espandi as espandiCache } from "../_shared/analisi.ts";
import { creaDati, ErroreServizio } from "../_shared/dati.ts";
import { eseguiPrecarica } from "../_shared/precarica.ts";
import { CATALOGO_TICKER } from "../_shared/catalogo_tickers.ts";
import { elaboraVerdetti } from "../_shared/registro_verdetti.ts";
import { leggiGruppo, salvaContributo } from "../_shared/gruppo.ts";
import { soloBarreChiuse } from "../_shared/analisi.ts";
import { confrontaFonti, conRetry, mercatoDebole, stooq } from "../_shared/provider.ts";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const { datiTitolo, segnaErrore, segnaIncerti } = creaDati(sb, {
  tdKey: env("TWELVEDATA_API_KEY"), cacheOre: 0, storicoGiorni: Number(env("STORICO_GIORNI", "5000")),
});

const secondaFonte = stooq();
const CONTROLLO_INCROCIATO = env("CONTROLLO_INCROCIATO", "1") !== "0";
async function log(livello: string, componente: string, messaggio: string) {
  try { await sb.rpc("scrivi_log", { p_livello: livello, p_componente: componente, p_messaggio: messaggio }); } catch (_e) { /* il log non blocca */ }
}

function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return risposta({ ok: false, errore: "Metodo non consentito" }, 405);
  const segreto = env("PRECARICA_SECRET");
  if (segreto.length < 16) return risposta({ ok: false, errore: "PRECARICA_SECRET non configurato (almeno 16 caratteri)." }, 500);
  if (!uguali(req.headers.get("x-cron-secret") || "", segreto)) return risposta({ ok: false, errore: "Non autorizzato" }, 401);
  const inizio = new Date().toISOString();
  // regime di mercato: SPY sotto la media a 200 giorni (letto dalla copia salvata, nessuna chiamata in piu')
  let regime = false;
  try { const { data } = await sb.from("price_cache").select("dati").eq("ticker", "SPY").maybeSingle(); if (data && data.dati) regime = mercatoDebole(soloBarreChiuse(espandiCache(data.dati))); } catch (_e) { /* senza regime */ }
  try {
    const riepilogo = await eseguiPrecarica({
      daAggiornare: async (limite) => {
        const { data, error } = await sb.rpc("titoli_da_precaricare", { p_limite: limite, p_extra: CATALOGO_TICKER });
        if (error) throw new Error("rpc");
        return (data || []).map((x: any) => String(x.ticker));
      },
      scarica: async (t) => {
        const r = await conRetry(() => datiTitolo(t)); // cacheOre = 0: scarica sempre; riprova solo gli errori temporanei
        // se il servizio e' al limite, datiTitolo ripiega sulla copia vecchia: qui lo trattiamo come stop
        if (!r.scaricato) throw new ErroreServizio(429, "LIMITE_MINUTO", "Limite del servizio dati");
        return r.barre;
      },
      dopo: async (t, barreGrezze) => {
        const barre = soloBarreChiuse(barreGrezze as any);
        const { data: aperti } = await sb.from("verdetti_orizzonte").select("id, orizzonte, data_verdetto").eq("ticker", t).is("data_esito", null);
        await salvaContributo(sb, t, barre as any); // alimenta lo studio di gruppo
        const { dati } = await leggiGruppo(sb, t, barre as any);
        // controllo incrociato con una seconda fonte (se raggiungibile): differenza > 2% = "dati incerti"
        let incerti = false;
        if (CONTROLLO_INCROCIATO) {
          const esito = confrontaFonti(barre as any, await secondaFonte.serie(t));
          incerti = esito === "incerto";
          await segnaIncerti(t, incerti);
          if (incerti) await log("avviso", "dati", "Controllo incrociato: " + t + " differisce dalla seconda fonte");
        }
        const { nuovi, chiusure } = elaboraVerdetti(t, barre as any, (aperti || []) as any, new Date(), dati, { regimeSfavorevole: regime, datiIncerti: incerti });
        if (nuovi.length) await sb.from("verdetti_orizzonte").upsert(nuovi, { onConflict: "ticker,orizzonte,data_verdetto", ignoreDuplicates: true });
        for (const c of chiusure) await sb.from("verdetti_orizzonte").update({ data_esito: c.data_esito, rendimento: c.rendimento }).eq("id", c.id);
        return { incerti };
      },
      segnaErrore,
      attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
      adesso: () => Date.now(),
    }, { massimo: Number(env("PRECARICA_MAX", "12")), pausaMs: Number(env("PAUSA_MS", "7700")), durataMaxMs: 125000 });
    if (riepilogo.richiesti > 0) {
      await sb.from("precarica_run").insert({ iniziato_il: inizio, finito_il: new Date().toISOString(), titoli_ok: riepilogo.scaricati, titoli_errore: riepilogo.errori, titoli_incerti: riepilogo.incerti, note: riepilogo.stop });
      await sb.from("precarica_run").delete().lt("iniziato_il", new Date(Date.now() - 30 * 864e5).toISOString());
    }
    for (const e of riepilogo.elenco_errori.slice(0, 5)) await log("errore", "precarica", e);
    if (riepilogo.stop === "configurazione") await log("errore", "precarica", "Configurazione dati non valida (chiave o piano)");
    // una volta al giorno (prima passata dopo le 23 UTC) aggiorna i declassamenti dei modelli
    if (new Date().getUTCHours() === 23) await sb.rpc("aggiorna_declassamenti");
    return risposta({ ok: true, ...riepilogo });
  } catch (_e) {
    await log("errore", "precarica", "Errore imprevisto durante il precaricamento");
    return risposta({ ok: false, errore: "Errore durante il precaricamento." }, 500);
  }
});
