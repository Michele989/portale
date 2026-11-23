// =========================================================================
// PREVISIONI PROBABILISTICHE a orizzonte fisso (21 / 63 / 252 sedute). Funzioni pure.
//
// Regole del metodo (non negoziabili):
//  - il segnale nasce alla CHIUSURA del giorno T; l'ingresso simulato e' all'APERTURA di T+1
//    (se l'apertura non e' disponibile nei dati vecchi, alla chiusura di T+1: mai alla chiusura di T);
//  - l'uscita e' la chiusura della seduta T+h;
//  - a una data T si usano SOLO rendimenti gia' conclusi (il rendimento che parte il giorno s e'
//    noto solo da s+h in poi): nessun dato futuro entra nella stima;
//  - tre modelli separati, mai mescolati: "base" (storia del titolo), "simili" (giorni con lo
//    stesso stato tecnico di oggi, con riduzione verso la base se i casi sono pochi) e
//    "bootstrap" (rendimenti recenti ricampionati a blocchi). Il confronto lo fa il registro.
//  - sono frequenze/simulazioni basate sul passato: NON sono previsioni certe.
// =========================================================================
import { rsiAt, smaAt } from "./analisi.ts";
import type { Barra } from "./analisi.ts";

export const ORIZZONTI_PREV = [21, 63, 252] as const;
export type OrizzontePrev = 21 | 63 | 252;
export type ModelloPrev = "base" | "simili" | "bootstrap";
export const VERSIONE_PREV = "p1.0";
export type StatoGiorno = "ipervenduto" | "forte" | "neutro" | "debole" | "nd";

export interface PrevisioneTitolo {
  orizzonte: OrizzontePrev;
  modello: ModelloPrev;
  probSu: number; // 0..1
  mediana: number; // % rendimento
  p05: number; p95: number; // %
  probPerd5: number; probGuad5: number; probPerd10: number; probGuad10: number; // 0..1
  nEff: number; // finestre indipendenti (non sovrapposte) alla base della stima
  stato: StatoGiorno; // stato tecnico del titolo alla data della previsione
  inEuro: false;
}

// ---------- numeri casuali riproducibili ----------
export function seme(testo: string): number {
  let h = 2166136261;
  for (let i = 0; i < testo.length; i++) { h ^= testo.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(ordinato: number[], q: number): number {
  const n = ordinato.length;
  if (!n) return NaN;
  const pos = (n - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return ordinato[lo] + (ordinato[hi] - ordinato[lo]) * (pos - lo);
}

// ---------- stato tecnico di ogni giorno (stessa regola di analizzaSerie) ----------
function adxSerie(h: number[], l: number[], c: number[], p = 14): (number | null)[] {
  const n = h.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < p * 2 + 2) return out;
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const wilder = (arr: number[]): number[] => {
    let s0 = 0;
    for (let i = 0; i < p; i++) s0 += arr[i];
    const o = [s0];
    for (let i = p; i < arr.length; i++) o.push(o[o.length - 1] - o[o.length - 1] / p + arr[i]);
    return o;
  };
  const trS = wilder(tr), pS = wilder(plusDM), mS = wilder(minusDM);
  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const pdi = trS[i] ? 100 * pS[i] / trS[i] : 0, mdi = trS[i] ? 100 * mS[i] / trS[i] : 0;
    const somma = pdi + mdi;
    dx.push(somma ? 100 * Math.abs(pdi - mdi) / somma : 0);
  }
  // dx[j] si riferisce alla barra p + j
  let adx = 0;
  for (let j = 0; j < p; j++) adx += dx[j];
  adx /= p;
  out[p + p - 1] = adx;
  for (let j = p; j < dx.length; j++) { adx = (adx * (p - 1) + dx[j]) / p; out[p + j] = adx; }
  // la funzione originale richiede almeno 2p+2 barre: prima di allora "non disponibile"
  for (let i = 0; i < p * 2 + 1 && i < n; i++) out[i] = null;
  return out;
}

export function serieStati(cron: Barra[]): StatoGiorno[] {
  const n = cron.length;
  const c = cron.map((x) => x.c), h = cron.map((x) => x.h), l = cron.map((x) => x.l), v = cron.map((x) => x.v);
  const out: StatoGiorno[] = new Array(n).fill("nd");
  const adx = adxSerie(h, l, c, 14);
  // medie mobili con somme cumulate
  const cum = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + c[i];
  const sma = (i: number, p: number): number | null => (i + 1 < p ? null : (cum[i + 1] - cum[i + 1 - p]) / p);
  const sma50 = c.map((_, i) => sma(i, 50));
  for (let i = 59; i < n; i++) {
    const s50 = sma50[i] as number, s200 = i + 1 >= 200 ? sma(i, 200) : null;
    const rsi = rsiAt(c, i, 14);
    let punti = 0;
    if (c[i] > s50) punti++;
    if (s200 !== null && c[i] > s200) punti++;
    if (rsi !== null && rsi >= 50 && rsi <= 70) punti++;
    const a = adx[i];
    if (a !== null && a >= 20) punti++;
    let trend3: boolean | null = null;
    if (i + 1 >= 52) {
      trend3 = true;
      for (let k = i - 2; k <= i; k++) { const s = sma50[k]; if (s === null || c[k] <= s) { trend3 = false; break; } }
    }
    let volOk: boolean | null = null;
    if (i + 1 >= 22) {
      let m = 0;
      for (let k = i - 20; k <= i - 1; k++) m += v[k];
      m /= 20;
      volOk = m > 0 && v[i] > 0 ? v[i] / m > 1.2 : null;
    }
    const confermato = trend3 === true && volOk !== false;
    if (rsi !== null && rsi < 35 && c[i] < s50) out[i] = "ipervenduto";
    else if (punti >= 3 && confermato) out[i] = "forte";
    else if (punti >= 2) out[i] = "neutro";
    else out[i] = "debole";
  }
  return out;
}

// ---------- rendimenti futuri a orizzonte fisso (in %), ingresso all'apertura di T+1 ----------
export function rendFuturi(cron: Barra[], h: number): (number | null)[] {
  const n = cron.length;
  const r: (number | null)[] = new Array(n).fill(null);
  for (let t = 0; t + h <= n - 1; t++) {
    const e = cron[t + 1];
    const ingresso = e.o && e.o > 0 ? e.o : e.c;
    r[t] = (cron[t + h].c / ingresso - 1) * 100;
  }
  return r;
}

// Rendimento reale di una previsione fatta alla data `dataPrev` (null se non ancora maturata).
export function esitoPrevisione(recentiPrima: Barra[], dataPrev: string, h: number) {
  const cron = recentiPrima.slice().reverse();
  const idx = cron.findIndex((b) => b.d === dataPrev);
  if (idx < 0 || idx + h > cron.length - 1) return null;
  const e = cron[idx + 1];
  const suApertura = !!(e.o && e.o > 0);
  const ingresso = suApertura ? (e.o as number) : e.c;
  const rendimento = (cron[idx + h].c / ingresso - 1) * 100;
  return { data_ingresso: e.d, prezzo_ingresso: ingresso, data_esito: cron[idx + h].d, rendimento, su: rendimento > 0, su_apertura: suApertura };
}

function riassunto(r: number[], h: number, modello: ModelloPrev, stato: StatoGiorno, probSu: number, nEff: number): PrevisioneTitolo {
  const o = r.slice().sort((a, b) => a - b);
  const n = o.length;
  const share = (f: (x: number) => boolean) => r.filter(f).length / n;
  return {
    orizzonte: h as OrizzontePrev, modello, probSu,
    mediana: quantile(o, 0.5), p05: quantile(o, 0.05), p95: quantile(o, 0.95),
    probPerd5: share((x) => x <= -5), probGuad5: share((x) => x >= 5),
    probPerd10: share((x) => x <= -10), probGuad10: share((x) => x >= 10),
    nEff, stato, inEuro: false,
  };
}

export const PESO_RIDUZIONE = 20; // "simili": con nEff finestre indipendenti il peso del condizionato e' nEff/(nEff+20)
export const MIN_INDIP_BASE = 5; // meno di 5 finestre indipendenti: nessuna previsione
export const MIN_CASI_SIMILI = 30;

// Probabilita' "simili" ridotta verso la base (usata in modo identico dal backtest).
export function probSimili(pCond: number, nCond: number, pBase: number, h: number): number {
  const nEff = nCond / h;
  const w = nEff / (nEff + PESO_RIDUZIONE);
  return w * pCond + (1 - w) * pBase;
}

// Bootstrap a blocchi dei rendimenti giornalieri recenti: stima la DISPERSIONE attuale, non la direzione.
export function bootstrapBlocchi(chiusureCron: number[], h: number, semeTesto: string, sim = 2000, blocco = 10, finestra = 756): number[] {
  const c = chiusureCron.slice(-(finestra + 1));
  const ret: number[] = [];
  for (let i = 1; i < c.length; i++) ret.push(c[i] / c[i - 1] - 1);
  if (ret.length < blocco * 3) return [];
  const rnd = mulberry32(seme(semeTesto));
  const finali: number[] = [];
  for (let s = 0; s < sim; s++) {
    let valore = 1, passi = 0;
    while (passi < h) {
      const inizio = Math.floor(rnd() * (ret.length - blocco + 1));
      for (let k = 0; k < blocco && passi < h; k++, passi++) valore *= 1 + ret[inizio + k];
    }
    finali.push((valore - 1) * 100);
  }
  return finali;
}

// Previsioni per tutti gli orizzonti alla data dell'ultima barra chiusa. `recentiPrima` = formato Twelve Data.
export function previsioniTitolo(recentiPrima: Barra[], opz: { sim?: number; ticker?: string } = {}): PrevisioneTitolo[] {
  const cron = recentiPrima.slice().reverse();
  const n = cron.length;
  if (n < 120) return [];
  const stati = serieStati(cron);
  const stato = stati[n - 1];
  const out: PrevisioneTitolo[] = [];
  const dataPrev = cron[n - 1].d;
  const ticker = opz.ticker || "";
  for (const h of ORIZZONTI_PREV) {
    const r = rendFuturi(cron, h);
    const noti: number[] = [], notiStato: StatoGiorno[] = [];
    for (let s = 0; s + h <= n - 1; s++) { const x = r[s]; if (x !== null) { noti.push(x); notiStato.push(stati[s]); } }
    const nEffBase = Math.floor(noti.length / h);
    if (nEffBase < MIN_INDIP_BASE) continue;
    const pBase = noti.filter((x) => x > 0).length / noti.length;
    out.push(riassunto(noti, h, "base", stato, pBase, nEffBase));
    // simili: stesso stato tecnico di oggi
    if (stato !== "nd") {
      const cond: number[] = [];
      for (let i = 0; i < noti.length; i++) if (notiStato[i] === stato) cond.push(noti[i]);
      if (cond.length >= MIN_CASI_SIMILI) {
        const pCond = cond.filter((x) => x > 0).length / cond.length;
        out.push(riassunto(cond, h, "simili", stato, probSimili(pCond, cond.length, pBase, h), Math.floor(cond.length / h)));
      }
    }
    // bootstrap a blocchi sui rendimenti recenti
    const fin = bootstrapBlocchi(cron.map((x) => x.c), h, ticker + dataPrev + h, opz.sim ?? 2000);
    if (fin.length) out.push(riassunto(fin, h, "bootstrap", stato, fin.filter((x) => x > 0).length / fin.length, nEffBase));
  }
  return out;
}
