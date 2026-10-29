// =========================================================================
// Studio per ORIZZONTE di investimento: breve (~1 mese), medio (~3 mesi), lungo (~1 anno).
// Funzioni pure (nessun accesso a rete o database), testabili con node.
//
// Per ogni orizzonte il calcolo restituisce:
//  - un punteggio a regole (4 criteri semplici e dichiarati);
//  - lo studio STORICO: cosa e' successo dopo ogni giorno dello storico (e dopo i giorni
//    "simili" a oggi) al rendimento a quell'orizzonte: % di casi positivi, mediana, 10°-90° percentile;
//  - un VENTAGLIO simulato (bootstrap a blocchi dei rendimenti passati, senza tendenza):
//    mostra quanto puo' oscillare il prezzo, non dove andra';
//  - un verdetto: favorevole / neutro / sfavorevole / non valutabile, con affidabilita' dello studio.
// Nulla di cio' e' una previsione o un consiglio personalizzato.
// =========================================================================
import { calcolaADX } from "./analisi.ts";
import type { Barra } from "./analisi.ts";

export type NomeOrizzonte = "breve" | "medio" | "lungo";
export const ORIZZONTI: Record<NomeOrizzonte, { giorni: number; etichetta: string }> = {
  breve: { giorni: 21, etichetta: "Breve termine (circa 1 mese)" },
  medio: { giorni: 63, etichetta: "Medio termine (circa 3 mesi)" },
  lungo: { giorni: 252, etichetta: "Lungo termine (circa 1 anno)" },
};

export interface StatRendimenti {
  n: number; // finestre sovrapposte considerate
  indipendenti: number; // finestre non sovrapposte: la vera quantita' di informazione
  pPositivi: number | null; // % di casi con rendimento > 0
  mediana: number | null; // %
  p10: number | null;
  p90: number | null;
  peggiore: number | null;
  migliore: number | null;
  pct?: number[]; // 101 percentili (0..100) del rendimento a fine periodo, in %
  pctMax?: number[]; // 101 percentili del massimo rendimento toccato durante il periodo, in %
}

// Studio di GRUPPO: stesso profilo di oggi, osservato su tutti i titoli del catalogo della stessa categoria.
export interface DatiGruppo { titoli: number; n: number; indip: number; pos: number; hist: number[] }
export interface StatGruppo {
  nome: string; titoli: number; n: number; indipendenti: number;
  pPositivi: number | null; mediana: number | null; p10: number | null; p90: number | null;
  pct?: number[]; // 101 percentili del rendimento a fine periodo, in %
}

export interface Ventaglio {
  giorni: number;
  passi: number[]; // giorni di borsa da oggi (0 = oggi)
  p10: number[]; p50: number[]; p90: number[]; // prezzi
  esempi: { basso: number[]; centrale: number[]; alto: number[] }; // tre percorsi simulati realistici
  volAnnua: number; // % su base annua dello storico usato
  finale: { p10: number; p50: number; p90: number }; // variazione % finale
  campioni: number; // giorni di storico usati
}

export type Verdetto = "favorevole" | "neutro" | "sfavorevole" | "non_valutabile";
export type Affidabilita = "alta" | "media" | "bassa" | "insufficiente";

export interface StudioOrizzonte {
  nome: NomeOrizzonte;
  etichetta: string;
  giorni: number;
  punteggio: number;
  criteri: { t: string; ok: boolean | null }[];
  verdetto: Verdetto;
  affidabilita: Affidabilita;
  storico: { tutti: StatRendimenti; simili: StatRendimenti | null; usato: "simili" | "tutti"; profilo: string };
  gruppo: StatGruppo | null; // stesso profilo, tutto il gruppo di titoli simili
  confermaGruppo: boolean | null; // null = campione di gruppo troppo piccolo
  ventaglio: Ventaglio | null;
  motivi: string[];
}

// ------------------------------------------------------------------ utilita'
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function quantile(ordinati: number[], q: number): number {
  if (!ordinati.length) return NaN;
  const pos = (ordinati.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return ordinati[lo] + (ordinati[hi] - ordinati[lo]) * (pos - lo);
}

function mediaSemplice(c: number[], i: number, p: number): number | null {
  if (i + 1 < p) return null;
  let s = 0;
  for (let k = i - p + 1; k <= i; k++) s += c[k];
  return s / p;
}

function rsiA(c: number[], i: number, p = 14): number | null {
  if (i < p) return null;
  let g = 0, pd = 0;
  for (let k = i - p + 1; k <= i; k++) {
    const d = c[k] - c[k - 1];
    if (d >= 0) g += d; else pd -= d;
  }
  if (pd === 0) return 100;
  return 100 - 100 / (1 + (g / p) / (pd / p));
}

// medie mobili per tutte le posizioni (somme cumulate: veloce anche su 1300 giorni)
function seriesMedia(c: number[], p: number): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  let s = 0;
  for (let i = 0; i < c.length; i++) {
    s += c[i];
    if (i >= p) s -= c[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}

const tabellaPercentili = (ord: number[]): number[] => Array.from({ length: 101 }, (_, k) => Math.round(quantile(ord, k / 100) * 1000) / 10);

function statistiche(rendimenti: number[], indici: number[], h: number, massimi?: number[]): StatRendimenti {
  const n = rendimenti.length;
  if (!n) return { n: 0, indipendenti: 0, pPositivi: null, mediana: null, p10: null, p90: null, peggiore: null, migliore: null };
  let indip = 0, ultimo = -Infinity;
  for (const i of indici) if (i - ultimo >= h) { indip++; ultimo = i; }
  const ord = rendimenti.slice().sort((a, b) => a - b);
  return {
    n, indipendenti: indip,
    pPositivi: (rendimenti.filter((x) => x > 0).length / n) * 100,
    mediana: quantile(ord, 0.5) * 100, p10: quantile(ord, 0.1) * 100, p90: quantile(ord, 0.9) * 100,
    peggiore: ord[0] * 100, migliore: ord[n - 1] * 100,
    ...(massimi ? { pct: tabellaPercentili(ord), pctMax: tabellaPercentili(massimi.slice().sort((a, b) => a - b)) } : {}),
  };
}

function livello(indipendenti: number): Affidabilita {
  if (indipendenti < 4) return "insufficiente";
  if (indipendenti < 8) return "bassa";
  if (indipendenti < 20) return "media";
  return "alta";
}

// ------------------------------------------------------------------ istogramma dei rendimenti (per i dati di gruppo)
// 152 classi: sotto -50%, poi 150 classi da 1% fino a +100%, sopra +100%.
export const HIST_LEN = 152;
export function indiceHist(ret: number): number {
  if (ret <= -0.5) return 0;
  if (ret >= 1) return HIST_LEN - 1;
  return 1 + Math.floor((ret + 0.5) / 0.01 + 1e-9);
}
function quantileHist(hist: number[], totale: number, q: number): number {
  const soglia = totale * q;
  let acc = 0;
  for (let k = 0; k < hist.length; k++) {
    acc += hist[k];
    if (acc >= soglia && hist[k] > 0) {
      if (k === 0) return -0.5;
      if (k === hist.length - 1) return 1;
      return -0.5 + (k - 1) * 0.01 + 0.005; // centro della classe
    }
  }
  return 0;
}
export function statGruppo(nome: string, g: DatiGruppo | null): StatGruppo | null {
  if (!g || !g.n || g.hist.length !== HIST_LEN) return null;
  return {
    nome, titoli: g.titoli, n: g.n, indipendenti: g.indip,
    pPositivi: (g.pos / g.n) * 100,
    mediana: quantileHist(g.hist, g.n, 0.5) * 100, p10: quantileHist(g.hist, g.n, 0.1) * 100, p90: quantileHist(g.hist, g.n, 0.9) * 100,
    pct: Array.from({ length: 101 }, (_, k) => Math.round(quantileHist(g.hist, g.n, k / 100) * 1000) / 10),
  };
}

// ------------------------------------------------------------------ profilo "simile a oggi"
function costruisciChiave(c: number[], rsi: (number | null)[], sma50: (number | null)[], sma200: (number | null)[]) {
  return (nome: NomeOrizzonte, i: number): number | null => {
    if (nome === "breve") {
      if (rsi[i] === null || sma50[i] === null) return null;
      const b = (rsi[i] as number) < 35 ? 0 : (rsi[i] as number) > 65 ? 2 : 1;
      return b * 2 + (c[i] > (sma50[i] as number) ? 1 : 0);
    }
    if (nome === "medio") {
      if (sma50[i] === null || sma200[i] === null) return null;
      const a = c[i] > (sma50[i] as number), b = (sma50[i] as number) > (sma200[i] as number);
      return a && b ? 2 : !a && !b ? 0 : 1;
    }
    if (sma200[i] === null || i < 252) return null;
    const a = c[i] > (sma200[i] as number), b = c[i] / c[i - 252] - 1 > 0;
    return a && b ? 2 : !a && !b ? 0 : 1;
  };
}
function contestoProfili(cron: Barra[]) {
  const c = cron.map((x) => x.c);
  const sma50 = seriesMedia(c, 50), sma200 = seriesMedia(c, 200);
  const rsi = c.map((_, i) => rsiA(c, i, 14));
  return { c, chiave: costruisciChiave(c, rsi, sma50, sma200) };
}

// Chiave del profilo di OGGI per ogni orizzonte (serve a chiedere i dati di gruppo giusti).
export function profiliOggi(cron: Barra[]): Record<NomeOrizzonte, number | null> {
  const { c, chiave } = contestoProfili(cron);
  const u = c.length - 1;
  return { breve: chiave("breve", u), medio: chiave("medio", u), lungo: chiave("lungo", u) };
}

export interface ContributoProfilo { orizzonte: NomeOrizzonte; profilo: number; n: number; indip: number; pos: number; hist: number[] }

// Contributo di UN titolo ai dati di gruppo: per ogni orizzonte e profilo, quanti casi storici,
// quanti periodi indipendenti, quanti positivi e la distribuzione dei rendimenti.
export function contributoProfili(cron: Barra[]): ContributoProfilo[] {
  const { c, chiave } = contestoProfili(cron);
  const ultimo = c.length - 1;
  const out: ContributoProfilo[] = [];
  for (const nome of Object.keys(ORIZZONTI) as NomeOrizzonte[]) {
    const h = ORIZZONTI[nome].giorni;
    const mappa = new Map<number, ContributoProfilo & { ultimo: number }>();
    for (let i = 1; i + h <= ultimo; i++) {
      const k = chiave(nome, i);
      if (k === null) continue;
      let r = mappa.get(k);
      if (!r) { r = { orizzonte: nome, profilo: k, n: 0, indip: 0, pos: 0, hist: new Array(HIST_LEN).fill(0), ultimo: -Infinity }; mappa.set(k, r); }
      const ret = c[i + h] / c[i] - 1;
      r.n++; if (ret > 0) r.pos++;
      r.hist[indiceHist(ret)]++;
      if (i - r.ultimo >= h) { r.indip++; r.ultimo = i; }
    }
    for (const r of mappa.values()) { const { ultimo: _u, ...pulito } = r; out.push(pulito); }
  }
  return out;
}

// ------------------------------------------------------------------ ventaglio simulato
export function ventaglio(c: number[], h: number, prove = 1000, blocco = 5, storico = 756): Ventaglio | null {
  const n = c.length;
  if (n < 120) return null;
  const da = Math.max(1, n - storico);
  const r: number[] = [];
  for (let i = da; i < n; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.length;
  if (m < blocco * 4) return null;
  const mu = r.reduce((a, b) => a + b, 0) / m;
  const centrati = r.map((x) => x - mu); // nessuna tendenza: il centro del ventaglio e' il prezzo di oggi
  const sd = Math.sqrt(centrati.reduce((a, b) => a + b * b, 0) / m);
  const K = Math.min(24, h);
  const passi: number[] = [0];
  for (let k = 1; k <= K; k++) passi.push(Math.round((k * h) / K));
  const rnd = lcg(h * 7919 + n * 31 + Math.round(c[n - 1] * 100));
  const prezzo0 = c[n - 1];
  const percorsi: number[][] = [];
  for (let p = 0; p < prove; p++) {
    const valori: number[] = [prezzo0];
    let cum = 0, t = 0, k = 1;
    while (t < h) {
      const s0 = Math.floor(rnd() * (m - blocco + 1));
      for (let b = 0; b < blocco && t < h; b++) {
        cum += centrati[s0 + b]; t++;
        if (k < passi.length && t === passi[k]) { valori.push(prezzo0 * Math.exp(cum)); k++; }
      }
    }
    percorsi.push(valori);
  }
  const L = passi.length;
  const p10: number[] = [], p50: number[] = [], p90: number[] = [];
  for (let j = 0; j < L; j++) {
    const col = percorsi.map((v) => v[j]).sort((a, b) => a - b);
    p10.push(quantile(col, 0.1)); p50.push(quantile(col, 0.5)); p90.push(quantile(col, 0.9));
  }
  // tre percorsi "esempio": quelli che a fine periodo stanno vicino al 10°, 50° e 90° percentile
  const ordine = percorsi.map((v, i) => [v[L - 1], i]).sort((a, b) => a[0] - b[0]);
  const pick = (q: number) => percorsi[ordine[Math.min(ordine.length - 1, Math.round((ordine.length - 1) * q))][1]];
  const arr = (a: number[]) => a.map((x) => Math.round(x * 100) / 100);
  return {
    giorni: h, passi,
    p10: arr(p10), p50: arr(p50), p90: arr(p90),
    esempi: { basso: arr(pick(0.1)), centrale: arr(pick(0.5)), alto: arr(pick(0.9)) },
    volAnnua: sd * Math.sqrt(252) * 100,
    finale: { p10: (p10[L - 1] / prezzo0 - 1) * 100, p50: (p50[L - 1] / prezzo0 - 1) * 100, p90: (p90[L - 1] / prezzo0 - 1) * 100 },
    campioni: m,
  };
}

// ------------------------------------------------------------------ studio completo
// cron: barre in ordine CRONOLOGICO (dalla piu' vecchia alla piu' recente).
export interface OpzioniOrizzonti {
  datiOk?: boolean;
  senzaVentaglio?: boolean; // risparmia calcolo quando serve solo il verdetto (registro notturno)
  gruppo?: Partial<Record<NomeOrizzonte, DatiGruppo | null>>; // dati di gruppo per il profilo di oggi
  nomeGruppo?: string;
}

export function analizzaOrizzonti(cron: Barra[], opz: OpzioniOrizzonti = {}): Record<NomeOrizzonte, StudioOrizzonte> {
  const c = cron.map((x) => x.c);
  const n = c.length, ultimo = n - 1;
  const datiOk = opz.datiOk !== false;
  const sma20 = seriesMedia(c, 20), sma50 = seriesMedia(c, 50), sma200 = seriesMedia(c, 200);
  const rsi = c.map((_, i) => rsiA(c, i, 14));
  const adx = calcolaADX(cron.map((x) => x.h).reverse(), cron.map((x) => x.l).reverse(), c.slice().reverse(), 14);
  const rend = (i: number, g: number) => (i - g >= 0 ? c[i] / c[i - g] - 1 : null);

  // massimo delle ultime 252 sedute: distanza dal picco
  const sede = c.slice(Math.max(0, n - 252));
  const distPicco = (1 - c[ultimo] / Math.max(...sede)) * 100;

  const sopra = (a: number | null, b: number | null) => (a === null || b === null ? null : a > b);
  const crescente = (s: (number | null)[], i: number, g: number) => (s[i] !== null && s[i - g] !== null && i - g >= 0 ? (s[i] as number) > (s[i - g] as number) : null);

  // criteri per orizzonte (ognuno vale 1 punto se vero)
  const rsiOra = rsi[ultimo];
  const criteri: Record<NomeOrizzonte, { t: string; ok: boolean | null }[]> = {
    breve: [
      { t: "Prezzo sopra la media a 20 giorni", ok: sopra(c[ultimo], sma20[ultimo]) },
      { t: "Media a 20 giorni in salita (vs 5 giorni fa)", ok: crescente(sma20, ultimo, 5) },
      { t: "RSI tra 45 e 70 (spinta senza eccesso)", ok: rsiOra === null ? null : rsiOra >= 45 && rsiOra <= 70 },
      { t: "Rendimento dell'ultimo mese positivo", ok: rend(ultimo, 21) === null ? null : (rend(ultimo, 21) as number) > 0 },
    ],
    medio: [
      { t: "Prezzo sopra la media a 50 giorni", ok: sopra(c[ultimo], sma50[ultimo]) },
      { t: "Media a 50 giorni sopra quella a 200", ok: sopra(sma50[ultimo], sma200[ultimo]) },
      { t: "Rendimento degli ultimi 3 mesi positivo", ok: rend(ultimo, 63) === null ? null : (rend(ultimo, 63) as number) > 0 },
      { t: "Trend deciso (ADX almeno 20)", ok: adx === null ? null : adx >= 20 },
    ],
    lungo: [
      { t: "Prezzo sopra la media a 200 giorni", ok: sopra(c[ultimo], sma200[ultimo]) },
      { t: "Media a 200 giorni in salita (vs 60 giorni fa)", ok: crescente(sma200, ultimo, 60) },
      { t: "Rendimento dell'ultimo anno positivo", ok: rend(ultimo, 252) === null ? null : (rend(ultimo, 252) as number) > 0 },
      { t: "Distanza dal massimo a 52 settimane inferiore al 20%", ok: n >= 252 ? distPicco < 20 : null },
    ],
  };

  // profilo "simile a oggi" per ogni orizzonte (stessa configurazione degli indicatori)
  const chiave = costruisciChiave(c, rsi, sma50, sma200);
  const descrizioneProfilo = (nome: NomeOrizzonte, k: number | null): string => {
    if (k === null) return "profilo non calcolabile";
    if (nome === "breve") return ["RSI basso (<35)", "RSI medio (35-65)", "RSI alto (>65)"][Math.floor(k / 2)] + (k % 2 ? ", prezzo sopra la media a 50 giorni" : ", prezzo sotto la media a 50 giorni");
    if (nome === "medio") return ["prezzo sotto SMA50 e SMA50 sotto SMA200 (ribasso)", "trend misto", "prezzo sopra SMA50 e SMA50 sopra SMA200 (rialzo)"][k];
    return ["sotto la media a 200 giorni e anno negativo", "segnali misti", "sopra la media a 200 giorni e anno positivo"][k];
  };

  const risultato = {} as Record<NomeOrizzonte, StudioOrizzonte>;
  for (const nome of ["breve", "medio", "lungo"] as NomeOrizzonte[]) {
    const { giorni: h, etichetta } = ORIZZONTI[nome];
    const cr = criteri[nome];
    const punteggio = cr.filter((x) => x.ok === true).length;
    const motivi: string[] = [];

    // finestre storiche: ogni giorno i con i+h disponibile
    const rTutti: number[] = [], iTutti: number[] = [];
    const rSimili: number[] = [], iSimili: number[] = [];
    const mTutti: number[] = [], mSimili: number[] = [];
    const conMax = !opz.senzaVentaglio;
    const kOra = chiave(nome, ultimo);
    for (let i = 1; i + h <= ultimo; i++) {
      const ret = c[i + h] / c[i] - 1;
      rTutti.push(ret); iTutti.push(i);
      let mx = 0;
      if (conMax) { let m = -Infinity; for (let j = i + 1; j <= i + h; j++) if (c[j] > m) m = c[j]; mx = m / c[i] - 1; mTutti.push(mx); }
      if (kOra !== null && chiave(nome, i) === kOra) { rSimili.push(ret); iSimili.push(i); if (conMax) mSimili.push(mx); }
    }
    const tutti = statistiche(rTutti, iTutti, h, conMax ? mTutti : undefined);
    const simili = kOra !== null && rSimili.length ? statistiche(rSimili, iSimili, h, conMax ? mSimili : undefined) : null;
    const usaSimili = !!simili && simili.indipendenti >= 8;
    const stat = usaSimili ? (simili as StatRendimenti) : tutti;

    // dati di gruppo: stesso profilo osservato su molti titoli simili
    const gr = statGruppo(opz.nomeGruppo || "gruppo", (opz.gruppo && opz.gruppo[nome]) || null);
    const grUtile = !!gr && gr.titoli >= 10 && gr.indipendenti >= 30;
    const conferma: boolean | null = grUtile ? ((gr as StatGruppo).pPositivi as number) >= 52 && ((gr as StatGruppo).mediana as number) > 0 : null;

    let affid = livello(stat.indipendenti);
    if (affid !== "insufficiente" && affid !== "alta" && !!gr && gr.titoli >= 30 && gr.indipendenti >= 100 && datiOk) {
      affid = affid === "bassa" ? "media" : "alta";
      motivi.push("precisione rafforzata dal campione di gruppo (" + gr.titoli + " titoli simili)");
    }
    if (!datiOk && affid !== "insufficiente") { affid = "bassa"; motivi.push("dati con anomalie"); }
    if (!usaSimili && tutti.indipendenti > 0) motivi.push("pochi casi simili a oggi: uso tutto lo storico");
    if (stat.indipendenti < 8) motivi.push("solo " + stat.indipendenti + " periodi indipendenti nello storico");

    let verdetto: Verdetto;
    const dispon = cr.filter((x) => x.ok !== null).length;
    if (affid === "insufficiente" || stat.pPositivi === null || dispon < 3) verdetto = "non_valutabile";
    else if (punteggio >= 3 && (stat.pPositivi as number) >= 55 && (stat.mediana as number) > 0) verdetto = "favorevole";
    else if ((punteggio <= 1 && !((stat.pPositivi as number) >= 55 && (stat.mediana as number) > 0)) || ((stat.mediana as number) < 0 && (stat.pPositivi as number) < 45)) verdetto = "sfavorevole";
    else verdetto = "neutro";
    if (verdetto === "favorevole" && conferma === false) {
      verdetto = "neutro";
      motivi.push("il gruppo di titoli simili non conferma (salito solo nel " + Math.round((gr as StatGruppo).pPositivi as number) + "% dei casi)");
    }

    risultato[nome] = {
      nome, etichetta, giorni: h, punteggio, criteri: cr, verdetto, affidabilita: affid,
      storico: { tutti, simili, usato: usaSimili ? "simili" : "tutti", profilo: descrizioneProfilo(nome, kOra) },
      gruppo: gr, confermaGruppo: conferma,
      ventaglio: opz.senzaVentaglio ? null : ventaglio(c, h),
      motivi,
    };
  }
  return risultato;
}
