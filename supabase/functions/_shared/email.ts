// Invio email tramite Resend o Brevo (entrambi con piano gratuito). Nessuna chiave nei log.
export interface ConfigMail { provider: string; apiKey: string; da: string }
export interface Mail { a: string; oggetto: string; testo: string; html: string; urlOneClick?: string }

function dividiMittente(da: string): { nome: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(da);
  return m ? { nome: m[1].replace(/^"|"$/g, ""), email: m[2] } : { nome: "", email: da.trim() };
}

export async function inviaEmail(cfg: ConfigMail, m: Mail, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!cfg.apiKey || !cfg.da) throw new Error("Email non configurata");
  const intestazioni: Record<string, string> = m.urlOneClick
    ? { "List-Unsubscribe": "<" + m.urlOneClick + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    : {};
  let r: Response;
  if (cfg.provider === "brevo") {
    const s = dividiMittente(cfg.da);
    r = await fetchFn("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": cfg.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: s.nome ? { name: s.nome, email: s.email } : { email: s.email },
        to: [{ email: m.a }], subject: m.oggetto, htmlContent: m.html, textContent: m.testo, headers: intestazioni,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } else if (cfg.provider === "resend") {
    r = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + cfg.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ from: cfg.da, to: [m.a], subject: m.oggetto, html: m.html, text: m.testo, headers: intestazioni }),
      signal: AbortSignal.timeout(20000),
    });
  } else {
    throw new Error("MAIL_PROVIDER non valido (usa resend o brevo)");
  }
  if (!r.ok) throw new Error("Invio email rifiutato (HTTP " + r.status + ")");
}
