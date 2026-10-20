// Utilita' HTTP condivise dalle Edge Functions (CORS e risposte JSON)
export const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function risposta(corpo: unknown, stato = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export function opzioniCors(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: CORS }) : null;
}

export function tokenDa(req: Request): string {
  const h = req.headers.get("Authorization") || "";
  return h.replace(/^Bearer\s+/i, "").trim();
}
