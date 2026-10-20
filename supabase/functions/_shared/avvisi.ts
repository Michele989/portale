// =========================================================================
// AVVISI EMAIL: regole di uscita, testo dell'email e orchestrazione.
// Nessuna dipendenza da Deno/rete: tutto si puo' collaudare con dati finti.
// Sono SEGNALI TECNICI (regole matematiche su prezzi di chiusura), non consigli.
// =========================================================================
import { analizzaSerie, STANDARD } from "./analisi.ts";
import type { Barra } from "./analisi.ts";

export interface Posizione { ticker: string; quantita: number; prezzo_acquisto: number }
export interface Destinatario {
  user_id: string; username: string; email: string; token: string;
  stop_loss: number; take_profit: number; commissione: number; posizioni: Posizione[];
}
export interface Segnale { codice: "stop_pct" | "stop_atr" | "obiettivo"; testo: string }
export interface Voce { ticker: string; prezzo: number; acquisto: number; variazione: number; segnali: Segnale[] }

const nf = (n: number, d = 2) => Number(n).toLocaleString("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d });

export function segnaliUscita(
  pos: Posizione, prezzo: number, atr14: number | null,
  imp: { stop_loss: number; take_profit: number; commissione: number },
): Segnale[] {
  const acq = Number(pos.prezzo_acquisto), out: Segnale[] = [];
  if (!(acq > 0) || !(prezzo > 0)) return out;
  if (prezzo <= acq * (1 - imp.stop_loss / 100)) out.push({ codice: "stop_pct", testo: "stop-loss del " + nf(imp.stop_loss, 1) + "% raggiunto" });
  if (atr14 && prezzo <= acq - 2 * atr14) out.push({ codice: "stop_atr", testo: "stop ATR raggiunto (prezzo di acquisto meno 2 volte l'ATR)" });
  const tp = imp.take_profit + 2 * imp.commissione;
  if (prezzo >= acq * (1 + tp / 100)) out.push({ codice: "obiettivo", testo: "obiettivo del +" + nf(tp, 1) + "% raggiunto: valuta se incassare" });
  return out;
}

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function costruisciEmail(o: {
  username: string; voci: Voce[]; urlSito: string; urlDisiscrizione: string; nomeServizio: string;
}): { oggetto: string; testo: string; html: string } {
  const tick = o.voci.map((v) => v.ticker);
  const oggetto = "Segnale tecnico di uscita: " + tick.slice(0, 4).join(", ") + (tick.length > 4 ? " e altri" : "");
  const riga = (v: Voce) =>
    v.ticker + ": chiusura " + nf(v.prezzo) + " (acquisto " + nf(v.acquisto) + ", " + (v.variazione >= 0 ? "+" : "") + nf(v.variazione, 1) + "%) — " +
    v.segnali.map((s) => s.testo).join("; ");
  const avv = "Sono regole matematiche (stop e obiettivo) applicate ai prezzi di chiusura: un segnale tecnico generico, non un consiglio personalizzato. " +
    "I prezzi possono essere in ritardo o contenere errori e un gap di apertura può superare lo stop. La decisione resta tua.";
  const testo = "Ciao " + o.username + ",\n\na fine giornata le posizioni che hai inserito in " + o.nomeServizio + " mostrano questi segnali tecnici di uscita:\n\n" +
    o.voci.map((v) => "- " + riga(v)).join("\n") + "\n\n" + avv + "\n\nApri il portale: " + o.urlSito +
    "\n\nNon vuoi più ricevere questi avvisi? Disattivali qui: " + o.urlDisiscrizione + "\n";
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px">' +
    "<p>Ciao " + esc(o.username) + ",</p><p>a fine giornata le posizioni che hai inserito in <b>" + esc(o.nomeServizio) + "</b> mostrano questi segnali tecnici di uscita:</p><ul>" +
    o.voci.map((v) => "<li>" + esc(riga(v)) + "</li>").join("") + "</ul>" +
    '<p style="font-size:13px;color:#555">' + esc(avv) + "</p>" +
    '<p><a href="' + esc(o.urlSito) + '">Apri il portale</a></p>' +
    '<p style="font-size:12px;color:#777">Non vuoi più ricevere questi avvisi? <a href="' + esc(o.urlDisiscrizione) + '">Disattivali qui</a>.</p></div>';
  return { oggetto, testo, html };
}

// ---------------------------------------------------------------------------
export interface Deps {
  destinatari(): Promise<Destinatario[]>;
  recenti(): Promise<{ user_id: string; ticker: string; motivo: string }[]>;
  // consentiScarico=false: solo copia salvata. Restituisce null se il dato non e' disponibile.
  dati(ticker: string, consentiScarico: boolean): Promise<{ barre: Barra[]; scaricato: boolean } | null>;
  invia(m: { a: string; oggetto: string; testo: string; html: string; urlOneClick: string }): Promise<void>;
  registra(userId: string, ticker: string, motivi: string[]): Promise<void>;
  attendi(ms: number): Promise<void>;
  oggi(): Date;
}
export interface CfgAvvisi {
  urlSito: string; urlDisiscrizionePagina: string; urlOneClickBase: string;
  nomeServizio: string; maxScarichi: number; pausaMs: number;
}
export interface Riepilogo {
  destinatari: number; titoli: number; scaricati: number;
  rimandati: string[]; dati_scartati: string[];
  mail_inviate: number; errori_invio: number; errori_registro: number;
  invii: { username: string; titoli: string[] }[];
}

export async function eseguiAvvisi(deps: Deps, cfg: CfgAvvisi): Promise<Riepilogo> {
  const dest = await deps.destinatari();
  const rec = new Set((await deps.recenti()).map((r) => r.user_id + "|" + r.ticker + "|" + r.motivo));
  const ticker = Array.from(new Set(dest.flatMap((d) => (d.posizioni || []).map((p) => p.ticker.toUpperCase())))).sort();
  const info = new Map<string, { prezzo: number; atr14: number | null }>();
  const rimandati: string[] = [], scartati: string[] = [];
  let scaricati = 0;

  for (const t of ticker) {
    const r = await deps.dati(t, scaricati < cfg.maxScarichi);
    if (!r) { rimandati.push(t); continue; }
    if (r.scaricato) { scaricati++; if (cfg.pausaMs > 0) await deps.attendi(cfg.pausaMs); }
    const a = analizzaSerie(r.barre, STANDARD, { oggi: deps.oggi() });
    const eta = a ? (deps.oggi().getTime() - new Date(a.ultima + "T00:00:00Z").getTime()) / 86400000 : 999;
    if (!a || a.qualita.gravi || eta > 5) { scartati.push(t); continue; }
    info.set(t, { prezzo: a.prezzo, atr14: a.atr14 });
  }

  let inviate = 0, errInvio = 0, errReg = 0;
  const invii: { username: string; titoli: string[] }[] = [];
  for (const d of dest) {
    const voci: Voce[] = [];
    const motiviPerTitolo = new Map<string, string[]>();
    for (const p of d.posizioni || []) {
      const t = p.ticker.toUpperCase(), i = info.get(t);
      if (!i) continue;
      const tutti = segnaliUscita(p, i.prezzo, i.atr14, d);
      const nuovi = tutti.filter((s) => !rec.has(d.user_id + "|" + t + "|" + s.codice));
      if (!nuovi.length) continue;
      voci.push({ ticker: t, prezzo: i.prezzo, acquisto: Number(p.prezzo_acquisto), variazione: (i.prezzo / Number(p.prezzo_acquisto) - 1) * 100, segnali: nuovi });
      motiviPerTitolo.set(t, nuovi.map((s) => s.codice));
    }
    if (!voci.length) continue;
    const mail = costruisciEmail({
      username: d.username, voci, urlSito: cfg.urlSito, nomeServizio: cfg.nomeServizio,
      urlDisiscrizione: cfg.urlDisiscrizionePagina + "?t=" + d.token,
    });
    try {
      await deps.invia({ a: d.email, oggetto: mail.oggetto, testo: mail.testo, html: mail.html, urlOneClick: cfg.urlOneClickBase + "?t=" + d.token });
    } catch (_e) { errInvio++; continue; } // non registrato: ci riprova alla prossima esecuzione
    inviate++;
    invii.push({ username: d.username, titoli: voci.map((v) => v.ticker) });
    for (const [t, motivi] of motiviPerTitolo) {
      try { await deps.registra(d.user_id, t, motivi); } catch (_e) { errReg++; }
    }
  }
  return {
    destinatari: dest.length, titoli: ticker.length, scaricati, rimandati, dati_scartati: scartati,
    mail_inviate: inviate, errori_invio: errInvio, errori_registro: errReg, invii,
  };
}
