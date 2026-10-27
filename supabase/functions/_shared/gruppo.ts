// Studio di gruppo: lettura (per l'analisi) e scrittura (per il precaricamento notturno) dei dati sui
// titoli simili. Tutto con il database; nessuna chiamata al servizio dati.
import { contributoProfili, profiliOggi } from "./orizzonti.ts";
import type { DatiGruppo, NomeOrizzonte } from "./orizzonti.ts";
import type { Barra } from "./analisi.ts";
import { CATALOGO_GRUPPO } from "./catalogo_tickers.ts";

export function gruppoDi(ticker: string): string {
  return CATALOGO_GRUPPO[ticker] || "azioni"; // fuori catalogo: confronto con le azioni
}

// Dati di gruppo per il profilo di OGGI del titolo (barre dal piu' recente, come in cache).
export async function leggiGruppo(sb: any, ticker: string, recenti: Barra[]): Promise<{ gruppo: string; dati: Partial<Record<NomeOrizzonte, DatiGruppo | null>> }> {
  const g = gruppoDi(ticker);
  const dati: Partial<Record<NomeOrizzonte, DatiGruppo | null>> = {};
  try {
    const oggi = profiliOggi(recenti.slice().reverse());
    const chiavi = (Object.keys(oggi) as NomeOrizzonte[]).filter((o) => oggi[o] !== null).map((o) => ({ o, p: oggi[o] }));
    if (!chiavi.length) return { gruppo: g, dati };
    const { data, error } = await sb.rpc("studio_gruppo", { p_gruppo: g, p_chiavi: chiavi });
    if (error || !Array.isArray(data)) return { gruppo: g, dati };
    for (const r of data) {
      if (r && r.n > 0 && Array.isArray(r.hist) && r.hist.length) dati[r.o as NomeOrizzonte] = { titoli: r.titoli, n: r.n, indip: r.indip, pos: r.pos, hist: r.hist };
    }
  } catch (_e) { /* lo studio di gruppo e' un extra: mai bloccare l'analisi */ }
  return { gruppo: g, dati };
}

// Salva il contributo di un titolo del catalogo (solo i titoli del catalogo alimentano il gruppo).
export async function salvaContributo(sb: any, ticker: string, recenti: Barra[]): Promise<boolean> {
  if (!CATALOGO_GRUPPO[ticker]) return false;
  const righe = contributoProfili(recenti.slice().reverse()).map((r) => ({
    ticker, gruppo: CATALOGO_GRUPPO[ticker], orizzonte: r.orizzonte, profilo: r.profilo, n: r.n, indip: r.indip, pos: r.pos, hist: r.hist,
    aggiornato_il: new Date().toISOString(),
  }));
  if (!righe.length) return false;
  const { error } = await sb.from("profili_titolo").upsert(righe, { onConflict: "ticker,orizzonte,profilo" });
  return !error;
}
