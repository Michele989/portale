// Scrive le previsioni (una per titolo/data/orizzonte/modello, mai modificate) e valuta quelle maturate.
import { esitoPrevisione, previsioniTitolo, VERSIONE_PREV } from "./previsioni.ts";
import type { Barra } from "./analisi.ts";

export async function salvaPrevisioni(sb: any, ticker: string, barre: Barra[]): Promise<number> {
  if (!barre.length) return 0;
  const prev = previsioniTitolo(barre, { ticker });
  if (!prev.length) return 0;
  const data_prev = barre[0].d; // barre: dal piu' recente
  const righe = prev.map((p) => ({
    ticker, data_prev, orizzonte: p.orizzonte, modello: p.modello, versione: VERSIONE_PREV,
    prob_su: p.probSu, mediana: p.mediana, p05: p.p05, p95: p.p95,
    prob_perd5: p.probPerd5, prob_guad5: p.probGuad5, prob_perd10: p.probPerd10, prob_guad10: p.probGuad10,
    n_eff: p.nEff, stato: p.stato,
  }));
  const { error } = await sb.from("previsioni").upsert(righe, { onConflict: "ticker,data_prev,orizzonte,modello,versione", ignoreDuplicates: true });
  if (error) throw new Error("previsioni");
  return righe.length;
}

export async function valutaPrevisioni(sb: any, ticker: string, barre: Barra[]): Promise<number> {
  const { data: aperte } = await sb.rpc("previsioni_aperte", { p_ticker: ticker });
  const righe: any[] = [];
  const visti = new Map<string, ReturnType<typeof esitoPrevisione>>();
  for (const p of aperte || []) {
    const k = p.data_prev + "/" + p.orizzonte;
    if (!visti.has(k)) visti.set(k, esitoPrevisione(barre, String(p.data_prev), Number(p.orizzonte)));
    const e = visti.get(k);
    if (e) righe.push({ previsione_id: p.id, data_ingresso: e.data_ingresso, prezzo_ingresso: e.prezzo_ingresso, su_apertura: e.su_apertura, data_esito: e.data_esito, rendimento: e.rendimento, su: e.su });
  }
  if (righe.length) await sb.from("previsioni_esiti").upsert(righe, { onConflict: "previsione_id", ignoreDuplicates: true });
  return righe.length;
}
