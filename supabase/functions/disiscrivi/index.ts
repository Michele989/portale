// =========================================================================
// EDGE FUNCTION: disiscrivi
// Disattiva gli avvisi email tramite il token personale contenuto nel link
// dell'email. Pubblicare con --no-verify-jwt (il token e' l'autorizzazione).
// =========================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { opzioniCors, risposta } from "../_shared/http.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const cors = opzioniCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return risposta({ ok: false, errore: "Metodo non consentito" }, 405);
  let token = new URL(req.url).searchParams.get("t") || "";
  if (!token) {
    try { const b = await req.json(); token = String(b.t || ""); } catch (_e) { /* il corpo del one-click non e' JSON */ }
  }
  if (!UUID.test(token)) return risposta({ ok: false, errore: "Link non valido." }, 400);
  const { data, error } = await sb.rpc("disattiva_avvisi", { p_token: token });
  if (error) return risposta({ ok: false, errore: "Errore, riprova più tardi." }, 500);
  if (!data) return risposta({ ok: false, errore: "Link non valido o già usato." }, 404);
  return risposta({ ok: true });
});
