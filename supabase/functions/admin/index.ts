// =========================================================================
// EDGE FUNCTION: admin
// Pannello amministratore: elenco utenti, creazione/disattivazione chiavi,
// ricarica usi, reset password, eliminazione utente.
// Accessibile solo a chi e' nella tabella public.admins.
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { opzioniCors, risposta, tokenDa } from "../_shared/http.ts";
import { riepilogoVerdetti } from "../_shared/registro_verdetti.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // niente I, O, 0, 1

function casuale(n: number): number[] {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return Array.from(a);
}

function nuovoCodice(): string {
  const r = casuale(12).map((x) => ALFABETO[x % ALFABETO.length]).join("");
  return "MA-" + r.slice(0, 4) + "-" + r.slice(4, 8) + "-" + r.slice(8, 12);
}

function passwordTemporanea(): string {
  return casuale(12).map((x) => ALFABETO[x % ALFABETO.length]).join("");
}

function intero(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => "\\" + m);
}

async function trovaUtente(testo: string) {
  const t = testo.trim();
  if (!t) return null;
  const campo = t.includes("@") ? "email" : "username";
  const { data } = await sb.from("profiles").select("user_id, username, email").ilike(campo, escapeLike(t)).limit(1).maybeSingle();
  return data;
}

Deno.serve(async (req: Request) => {
  const cors = opzioniCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return risposta({ ok: false, errore: "Metodo non consentito" }, 405);

  const { data: ut, error: errAuth } = await sb.auth.getUser(tokenDa(req));
  if (errAuth || !ut || !ut.user) return risposta({ ok: false, errore: "Sessione scaduta: accedi di nuovo." }, 401);
  const adminId = ut.user.id;
  const { data: isAdmin } = await sb.from("admins").select("user_id").eq("user_id", adminId).maybeSingle();
  if (!isAdmin) return risposta({ ok: false, errore: "Accesso riservato all'amministratore." }, 403);

  let b: any = {};
  try { b = await req.json(); } catch (_e) { /* vuoto */ }

  try {
    switch (b.azione) {
      case "elenco": {
        const sette = new Date(Date.now() - 7 * 86400000).toISOString();
        const [{ data: profili }, { data: chiavi }, { data: admins }, avvAttivi, avvInviati] = await Promise.all([
          sb.from("profiles").select("user_id, username, email, created_at").order("created_at", { ascending: false }),
          sb.from("access_keys").select("*").order("id", { ascending: false }),
          sb.from("admins").select("user_id"),
          sb.from("impostazioni_rischio").select("user_id", { count: "exact", head: true }).eq("avvisi_email", true),
          sb.from("avvisi_inviati").select("id", { count: "exact", head: true }).gte("inviato_il", sette),
        ]);
        const setAdmin = new Set((admins || []).map((a: any) => a.user_id));
        const ultima = new Map<string, any>();
        for (const k of chiavi || []) if (!ultima.has(k.user_id)) ultima.set(k.user_id, k);
        const utenti = (profili || []).map((p: any) => ({
          ...p, admin: setAdmin.has(p.user_id), chiave: ultima.get(p.user_id) || null,
        }));
        const ora = Date.now();
        const attive = utenti.filter((u: any) => u.chiave && u.chiave.stato === "attiva" && u.chiave.usi_rimasti > 0 &&
          (!u.chiave.scade_il || new Date(u.chiave.scade_il).getTime() > ora));
        const stats = {
          utenti: utenti.length,
          senza_chiave: utenti.filter((u: any) => !u.chiave).length,
          attive: attive.length,
          usi_rimasti_totali: attive.reduce((s: number, u: any) => s + u.chiave.usi_rimasti, 0),
          usi_consumati_totali: (chiavi || []).reduce((s: number, k: any) => s + (k.usi_totali - k.usi_rimasti), 0),
          avvisi_attivi: avvAttivi.count || 0,
          avvisi_7gg: avvInviati.count || 0,
        };
        return risposta({ ok: true, utenti, stats });
      }

      case "verdetti": {
        const { data, error } = await sb.rpc("verdetti_conteggi");
        if (error || !data) return risposta({ ok: false, errore: "Registro non disponibile: esegui di nuovo schema.sql in Supabase." }, 500);
        // Anteprima: verdetti dell'ultimo giorno registrato, per orizzonte
        const { data: ultimoGiorno } = await sb.from("verdetti_orizzonte").select("data_verdetto").order("data_verdetto", { ascending: false }).limit(1);
        const giorno = ultimoGiorno && ultimoGiorno[0] ? ultimoGiorno[0].data_verdetto : null;
        const oggi: Record<string, Record<string, number>> = {};
        if (giorno) {
          const nomi = ["breve", "medio", "lungo"], verd = ["favorevole", "neutro", "sfavorevole"];
          const conteggi = await Promise.all(nomi.flatMap((o) => verd.map(async (v) => {
            const { count } = await sb.from("verdetti_orizzonte").select("id", { count: "exact", head: true })
              .eq("data_verdetto", giorno).eq("orizzonte", o).eq("verdetto", v);
            return { o, v, n: count || 0 };
          })));
          for (const c of conteggi) { (oggi[c.o] = oggi[c.o] || {})[c.v] = c.n; }
        }
        return risposta({ ok: true, dal: data.dal, giorno, oggi, orizzonti: riepilogoVerdetti(data.righe || [], data.aperti || {}) });
      }

      case "report": {
        const mese = /^\d{4}-\d{2}$/.test(String(b.mese || "")) ? String(b.mese) + "-01" : undefined;
        const { data: righe } = await sb.rpc("report_mensile", mese ? { p_mese: mese } : {});
        const { data: stato } = await sb.rpc("stato_servizio");
        const { data: log } = await sb.from("servizio_log").select("quando, livello, componente, messaggio").order("quando", { ascending: false }).limit(30);
        return risposta({ ok: true, righe: righe || [], stato, log: log || [] });
      }

      case "crea_chiave": {
        const utente = await trovaUtente(String(b.username || ""));
        if (!utente) return risposta({ ok: false, errore: "Utente non trovato. Controlla l'username digitato." }, 404);
        const usi = intero(b.usi, 1, 100000);
        if (usi === null) return risposta({ ok: false, errore: "Numero di usi non valido (1-100000)." }, 400);
        let giorni: number | null = null;
        if (b.giorni !== null && b.giorni !== undefined && b.giorni !== "") {
          giorni = intero(b.giorni, 1, 3650);
          if (giorni === null) return risposta({ ok: false, errore: "Giorni di validita' non validi (1-3650)." }, 400);
        }
        const note = b.note ? String(b.note).slice(0, 200) : null;
        let codicePersonale = String(b.codice || "").trim().toUpperCase();
        if (codicePersonale && !/^[A-Z0-9-]{6,30}$/.test(codicePersonale)) {
          return risposta({ ok: false, errore: "Codice non valido: 6-30 caratteri, solo lettere, numeri e trattini." }, 400);
        }
        for (let tentativo = 0; tentativo < 5; tentativo++) {
          const codice = codicePersonale || nuovoCodice();
          const { data, error } = await sb.rpc("crea_chiave", {
            p_user: utente.user_id, p_codice: codice, p_usi: usi, p_giorni: giorni, p_note: note,
          });
          if (!error) return risposta({ ok: true, id: data, codice, username: utente.username, usi, giorni });
          if (error.code === "23505" && !codicePersonale) continue; // codice casuale gia' esistente: riprovo
          if (error.code === "23505") return risposta({ ok: false, errore: "Questo codice esiste gia'." }, 409);
          return risposta({ ok: false, errore: "Impossibile creare la chiave." }, 500);
        }
        return risposta({ ok: false, errore: "Impossibile generare un codice univoco, riprova." }, 500);
      }

      case "imposta_stato": {
        const id = intero(b.chiave_id, 1, Number.MAX_SAFE_INTEGER);
        if (id === null || !["attiva", "disattivata"].includes(b.stato)) return risposta({ ok: false, errore: "Richiesta non valida." }, 400);
        const { data: k } = await sb.from("access_keys").select("id, stato").eq("id", id).maybeSingle();
        if (!k) return risposta({ ok: false, errore: "Chiave non trovata." }, 404);
        if (k.stato === "sostituita") return risposta({ ok: false, errore: "Questa chiave e' stata sostituita da una piu' recente." }, 409);
        const { error } = await sb.from("access_keys").update({ stato: b.stato }).eq("id", id);
        if (error) return risposta({ ok: false, errore: "Impossibile cambiare lo stato." }, 500);
        return risposta({ ok: true });
      }

      case "aggiungi_usi": {
        const id = intero(b.chiave_id, 1, Number.MAX_SAFE_INTEGER);
        const usi = intero(b.usi, 0, 100000);
        let giorni: number | null = null;
        if (b.giorni !== null && b.giorni !== undefined && b.giorni !== "") giorni = intero(b.giorni, 1, 3650);
        if (id === null || usi === null || (usi === 0 && giorni === null)) return risposta({ ok: false, errore: "Indica quanti usi (o giorni) aggiungere." }, 400);
        const { data, error } = await sb.rpc("aggiungi_usi", { p_key: id, p_usi: usi, p_giorni: giorni });
        if (error || data === null || data < 0) return risposta({ ok: false, errore: "Chiave non attiva o non trovata." }, 404);
        return risposta({ ok: true, usi_rimasti: data });
      }

      case "reset_password": {
        const uid = String(b.user_id || "");
        if (!/^[0-9a-f-]{36}$/i.test(uid)) return risposta({ ok: false, errore: "Utente non valido." }, 400);
        const nuova = passwordTemporanea();
        const { error } = await sb.auth.admin.updateUserById(uid, { password: nuova });
        if (error) return risposta({ ok: false, errore: "Impossibile reimpostare la password." }, 500);
        return risposta({ ok: true, password: nuova });
      }

      case "elimina_utente": {
        const uid = String(b.user_id || "");
        if (!/^[0-9a-f-]{36}$/i.test(uid)) return risposta({ ok: false, errore: "Utente non valido." }, 400);
        if (uid === adminId) return risposta({ ok: false, errore: "Non puoi eliminare il tuo account." }, 400);
        const { data: bersaglioAdmin } = await sb.from("admins").select("user_id").eq("user_id", uid).maybeSingle();
        if (bersaglioAdmin) return risposta({ ok: false, errore: "Non si puo' eliminare un altro amministratore." }, 400);
        const { error } = await sb.auth.admin.deleteUser(uid);
        if (error) return risposta({ ok: false, errore: "Impossibile eliminare l'utente." }, 500);
        return risposta({ ok: true });
      }

      default:
        return risposta({ ok: false, errore: "Azione sconosciuta." }, 400);
    }
  } catch (_e) {
    return risposta({ ok: false, errore: "Errore imprevisto del server." }, 500);
  }
});
