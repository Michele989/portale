// =========================================================================
// EDGE FUNCTION: precarica
// Chiamata ogni pochi minuti, di notte, da pg_cron (vedi cron_precarica.sql).
// Scarica i prezzi dei titoli seguiti dai clienti che non sono ancora aggiornati.
// Protetta da PRECARICA_SECRET: va pubblicata con --no-verify-jwt.
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { risposta } from "../_shared/http.ts";
import { creaDati, ErroreServizio } from "../_shared/dati.ts";
import { eseguiPrecarica } from "../_shared/precarica.ts";
import { elaboraVerdetti } from "../_shared/registro_verdetti.ts";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const { datiTitolo, segnaErrore } = creaDati(sb, {
  tdKey: env("TWELVEDATA_API_KEY"), cacheOre: 0, storicoGiorni: Number(env("STORICO_GIORNI", "5000")),
});

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
  try {
    const riepilogo = await eseguiPrecarica({
      daAggiornare: async (limite) => {
        const { data, error } = await sb.rpc("titoli_da_precaricare", { p_limite: limite });
        if (error) throw new Error("rpc");
        return (data || []).map((x: any) => String(x.ticker));
      },
      scarica: async (t) => {
        const r = await datiTitolo(t); // cacheOre = 0: scarica sempre
        // se il servizio e' al limite, datiTitolo ripiega sulla copia vecchia: qui lo trattiamo come stop
        if (!r.scaricato) throw new ErroreServizio(429, "LIMITE_MINUTO", "Limite del servizio dati");
        return r.barre;
      },
      dopo: async (t, barre) => {
        const { data: aperti } = await sb.from("verdetti_orizzonte").select("id, orizzonte, data_verdetto").eq("ticker", t).is("data_esito", null);
        const { nuovi, chiusure } = elaboraVerdetti(t, barre as any, (aperti || []) as any);
        if (nuovi.length) await sb.from("verdetti_orizzonte").upsert(nuovi, { onConflict: "ticker,orizzonte,data_verdetto", ignoreDuplicates: true });
        for (const c of chiusure) await sb.from("verdetti_orizzonte").update({ data_esito: c.data_esito, rendimento: c.rendimento }).eq("id", c.id);
      },
      segnaErrore,
      attendi: (ms) => new Promise((r) => setTimeout(r, ms)),
      adesso: () => Date.now(),
    }, { massimo: Number(env("PRECARICA_MAX", "12")), pausaMs: Number(env("PAUSA_MS", "7700")), durataMaxMs: 125000 });
    return risposta({ ok: true, ...riepilogo });
  } catch (_e) {
    return risposta({ ok: false, errore: "Errore durante il precaricamento." }, 500);
  }
});
