// =========================================================================
// CLASSIFICAZIONE DELL'EVIDENZA (sostituisce "favorevole/neutro/sfavorevole" come giudizio di affidabilita').
// Non dice "compra": dice quanto le regole tecniche hanno dimostrato di battere il caso, in base all'ULTIMA
// validazione dell'intero universo. Funzioni pure.
//   dimostrata       : almeno una regola supera la correzione per test multipli (Holm) E il Reality Check E regge nel periodo recente
//   non_dimostrata   : nessun vantaggio dimostrabile (il caso piu' probabile)
//   sfavorevole      : almeno una regola fa dimostrabilmente PEGGIO della media
//   insufficiente    : nessuna validazione disponibile
// =========================================================================
export type LivelloEvidenza = "dimostrata" | "non_dimostrata" | "sfavorevole" | "insufficiente";
export interface Evidenza { livello: LivelloEvidenza; titolo: string; testo: string; regole: { regola: string; orizzonte: number; stato: "dimostrata" | "sfavorevole" | "no" }[]; rc_p: number | null; data: string | null; versione: string | null }

export function classificaEvidenza(val: any, eseguita?: string | null): Evidenza {
  if (!val || !Array.isArray(val.regole) || !val.regole.length) {
    return { livello: "insufficiente", titolo: "Evidenza non ancora misurata", testo: "Non c'e' ancora una validazione dell'intero universo: i segnali tecnici vanno letti come semplici osservazioni.", regole: [], rc_p: null, data: null, versione: null };
  }
  const rcP = val.realityCheck && typeof val.realityCheck.pValore === "number" ? val.realityCheck.pValore : null;
  const rcOk = rcP !== null && rcP < 0.05;
  const regole = val.regole.map((r: any) => {
    const holm = typeof r.pHolm === "number" ? r.pHolm : 1;
    const recOk = r.recente && r.recente.ci95 && r.recente.ci95[0] > 0;
    const dim = holm < 0.05 && r.ci95 && r.ci95[0] > 0 && recOk && rcOk;
    const neg = r.ci95 && r.ci95[1] < 0 && r.recente && r.recente.ci95 && r.recente.ci95[1] < 0;
    return { regola: r.regola, orizzonte: r.orizzonte, stato: dim ? "dimostrata" : neg ? "sfavorevole" : "no" };
  });
  const nDim = regole.filter((r: any) => r.stato === "dimostrata").length, nNeg = regole.filter((r: any) => r.stato === "sfavorevole").length;
  const base = { regole, rc_p: rcP, data: eseguita ? String(eseguita).slice(0, 10) : null, versione: val.versione || null };
  if (nDim > 0) return { livello: "dimostrata", titolo: "Vantaggio dimostrato per alcune regole", testo: nDim + " regole su " + regole.length + " battono la media dei titoli anche dopo la correzione per i test multipli e nel periodo recente. Valgono solo per quelle regole e quegli orizzonti.", ...base };
  if (nNeg > 0) return { livello: "sfavorevole", titolo: "Alcune regole fanno peggio della media", testo: nNeg + " regole su " + regole.length + " hanno reso dimostrabilmente meno della media dei titoli. Nessuna regola ha un vantaggio dimostrato.", ...base };
  return { livello: "non_dimostrata", titolo: "Nessun vantaggio dimostrato", testo: "Sull'intero universo nessuna regola tecnica batte in modo dimostrabile la media dei titoli. Usa Tickly per misurare rischio e oscillazioni, non come previsione di rialzo.", ...base };
}

// Probabilita' ricalibrata: applicata SOLO se la ricalibrazione e' attiva per quel modello e orizzonte
export function probCalibrata(val: any, modello: string, orizzonte: number, p: number): number | null {
  const r = val && val.ricalibrazione && val.ricalibrazione[modello + "_" + orizzonte];
  if (!r || !r.attiva) return null;
  const x = Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
  return 1 / (1 + Math.exp(-(r.a + r.b * x)));
}
