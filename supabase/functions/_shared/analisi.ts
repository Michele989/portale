// =========================================================================
// ANALISI TECNICA - funzioni pure (nessuna dipendenza da Deno o dalla rete)
// Le serie di prezzi arrivano da Twelve Data in ordine "dal piu' recente".
// Segnali tecnici oggettivi calcolati su dati storici: NON sono previsioni.
// =========================================================================

export interface Barra {
  d: string; // data (YYYY-MM-DD)
  h: number; // massimo
  l: number; // minimo
  c: number; // chiusura
  v: number; // volume (0 se non disponibile)
}

export interface EsitoBacktest {
  n: number; // operazioni simulate
  vinti: number; // target raggiunto prima dello stop
  persi: number; // stop raggiunto prima del target
  scaduti: number; // ne' target ne' stop entro i giorni massimi (contati come non vinti)
  pct: number | null; // % di successo
  low: number | null; // estremo inferiore intervallo di Wilson 95%
  high: number | null; // estremo superiore
  giorniMedi: number | null; // giorni medi per raggiungere il target
}

export interface OpzioniAnalisi {
  tp: number; // take profit % (netto, i costi vengono sommati al target)
  sl: number; // stop loss %
  comm: number; // commissione % per operazione
  spread?: number; // spread + slittamento % (totale andata e ritorno)
}

export function media(a: number[]): number {
  let s = 0;
  for (const x of a) s += x;
  return s / a.length;
}

// ---- indicatori su serie CRONOLOGICA (dal piu' vecchio al piu' recente) ----
function smaAt(c: number[], i: number, p: number): number | null {
  if (i + 1 < p) return null;
  let s = 0;
  for (let k = i - p + 1; k <= i; k++) s += c[k];
  return s / p;
}

function rsiAt(c: number[], i: number, p = 14): number | null {
  if (i < p) return null;
  let g = 0, pd = 0;
  for (let k = i - p + 1; k <= i; k++) {
    const d = c[k] - c[k - 1];
    if (d >= 0) g += d; else pd -= d;
  }
  if (pd === 0) return 100;
  return 100 - 100 / (1 + (g / p) / (pd / p));
}

function atrAt(h: number[], l: number[], c: number[], i: number, p = 14): number | null {
  if (i < p) return null;
  let s = 0;
  for (let k = i - p + 1; k <= i; k++) {
    s += Math.max(h[k] - l[k], Math.abs(h[k] - c[k - 1]), Math.abs(l[k] - c[k - 1]));
  }
  return s / p;
}

// ---- versioni "dal piu' recente" (stessa convenzione di Twelve Data) ----
export function calcolaRSI(chiusureRecentiPrima: number[], period = 14): number | null {
  const c = chiusureRecentiPrima.slice().reverse();
  return rsiAt(c, c.length - 1, period);
}

export function calcolaATR(massimi: number[], minimi: number[], chiusure: number[], period = 14): number | null {
  const h = massimi.slice().reverse(), l = minimi.slice().reverse(), c = chiusure.slice().reverse();
  return atrAt(h, l, c, c.length - 1, period);
}

export function calcolaADX(massimi: number[], minimi: number[], chiusure: number[], period = 14): number | null {
  const h = massimi.slice().reverse(), l = minimi.slice().reverse(), c = chiusure.slice().reverse();
  const n = h.length;
  if (n < period * 2 + 2) return null;
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], down = l[i - 1] - l[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  function wilder(arr: number[], p: number): number[] {
    let s0 = 0;
    for (let i = 0; i < p; i++) s0 += arr[i];
    const out = [s0];
    for (let i = p; i < arr.length; i++) out.push(out[out.length - 1] - out[out.length - 1] / p + arr[i]);
    return out;
  }
  const trS = wilder(tr, period), pS = wilder(plusDM, period), mS = wilder(minusDM, period);
  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    const pdi = trS[i] ? 100 * pS[i] / trS[i] : 0;
    const mdi = trS[i] ? 100 * mS[i] / trS[i] : 0;
    const somma = pdi + mdi;
    dx.push(somma ? 100 * Math.abs(pdi - mdi) / somma : 0);
  }
  if (dx.length < period) return null;
  let adx = media(dx.slice(0, period));
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return adx;
}

// Trend confermato: negli ultimi 3 giorni la chiusura e' sempre sopra la SMA50 del giorno.
export function trendConfermato(chiusureCron: number[]): boolean | null {
  const n = chiusureCron.length;
  if (n < 52) return null;
  for (let i = n - 3; i < n; i++) {
    const s = smaAt(chiusureCron, i, 50);
    if (s === null || chiusureCron[i] <= s) return false;
  }
  return true;
}

// Rapporto tra volume di oggi e media dei 20 giorni precedenti (null se i volumi mancano).
export function rapportoVolume(volumiCron: number[]): number | null {
  const n = volumiCron.length;
  if (n < 22) return null;
  const prec = volumiCron.slice(n - 21, n - 1);
  const m = media(prec);
  if (!(m > 0) || !(volumiCron[n - 1] > 0)) return null;
  return volumiCron[n - 1] / m;
}

// Intervallo di confidenza di Wilson al 95% (in %). Corretto anche con 0% o 100%.
export function intervalloWilson95(k: number, n: number): { low: number; high: number } | null {
  if (n <= 0) return null;
  const z = 1.96, p = k / n;
  const den = 1 + (z * z) / n;
  const centro = (p + (z * z) / (2 * n)) / den;
  const marg = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return {
    low: Math.max(0, centro - marg) * 100,
    high: Math.min(1, centro + marg) * 100,
  };
}

export type TipoBacktest = "trend" | "ribasso";

function condizione(tipo: TipoBacktest, c: number[], i: number): boolean {
  const s = smaAt(c, i, 50);
  const r = rsiAt(c, i, 14);
  if (s === null || r === null) return false;
  if (tipo === "trend") return c[i] > s && r >= 50 && r <= 70;
  return c[i] < s && r < 35;
}

// Backtest sulle chiusure storiche (cronologiche). Il target include 2x commissione.
// Con nonSovrapposti=true una nuova operazione parte solo dopo la chiusura della precedente
// (campioni indipendenti: n non viene gonfiato).
export function backtest(
  c: number[],
  tipo: TipoBacktest,
  tp: number,
  sl: number,
  comm: number,
  nonSovrapposti = true,
  maxGiorni = 40,
): EsitoBacktest {
  const target = tp + 2 * comm;
  let vinti = 0, persi = 0, scaduti = 0, sommaGiorni = 0;
  const n = c.length;
  let i = 50;
  while (i < n - 1) {
    if (!condizione(tipo, c, i)) { i++; continue; }
    const entry = c[i];
    let fine = -1, esito = "";
    const limite = Math.min(n - 1, i + maxGiorni);
    for (let j = i + 1; j <= limite; j++) {
      const r = (c[j] / entry - 1) * 100;
      if (r >= target) { esito = "v"; fine = j; break; }
      if (r <= -sl) { esito = "p"; fine = j; break; }
    }
    if (fine < 0) {
      if (i + maxGiorni > n - 1) { i++; continue; } // non ancora risolta: non conteggiata
      esito = "s"; fine = i + maxGiorni;
    }
    if (esito === "v") { vinti++; sommaGiorni += fine - i; }
    else if (esito === "p") persi++;
    else scaduti++;
    i = nonSovrapposti ? fine + 1 : i + 1;
  }
  const tot = vinti + persi + scaduti;
  const w = intervalloWilson95(vinti, tot);
  return {
    n: tot, vinti, persi, scaduti,
    pct: tot ? (vinti / tot) * 100 : null,
    low: w ? w.low : null,
    high: w ? w.high : null,
    giorniMedi: vinti ? sommaGiorni / vinti : null,
  };
}

// ---- conversione dati Twelve Data <-> formato compatto di cache ----
export function daTwelveData(values: any[]): Barra[] {
  const out: Barra[] = [];
  for (const x of values || []) {
    const c = parseFloat(x.close), h = parseFloat(x.high), l = parseFloat(x.low);
    if (!isFinite(c) || !isFinite(h) || !isFinite(l) || c <= 0) continue;
    const v = parseFloat(x.volume);
    out.push({ d: String(x.datetime).slice(0, 10), h, l, c, v: isFinite(v) ? v : 0 });
  }
  return out; // dal piu' recente
}

export function comprimi(barre: Barra[]): { b: (string | number)[][] } {
  return { b: barre.map((x) => [x.d, x.h, x.l, x.c, x.v]) };
}

export function espandi(dati: any): Barra[] {
  const b: any[][] = dati && Array.isArray(dati.b) ? dati.b : [];
  return b.map((r) => ({ d: String(r[0]), h: Number(r[1]), l: Number(r[2]), c: Number(r[3]), v: Number(r[4]) }));
}

export function limita(x: number, min: number, max: number, def: number): number {
  const n = Number(x);
  if (!isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// =========================================================================
// SIMULAZIONE AVANZATA (barre complete: massimi/minimi, costi, fuori campione)
// =========================================================================
export interface Operazione {
  i: number; // indice (cronologico) del giorno di ingresso
  fine: number; // indice di uscita
  esito: "v" | "p" | "s";
  ret: number; // rendimento netto % dell'operazione
  giorni: number;
}

export interface StatOps {
  n: number; vinti: number; persi: number; scaduti: number;
  pct: number | null; low: number | null; high: number | null;
  giorniMedi: number | null;
  attesa: number | null; // rendimento medio netto per operazione (%)
  composto: number | null; // rendimento composto delle operazioni (%)
  maxDD: number | null; // massimo drawdown della curva delle operazioni (%)
  tempoInvestito: number | null; // % dei giorni passati in posizione
}

export const STANDARD: OpzioniAnalisi = { tp: 8, sl: 8, comm: 0.2, spread: 0 };
export const GIORNI_OOS = 252; // ultimi ~12 mesi tenuti da parte per il controllo fuori campione

function costoTotale(o: OpzioniAnalisi): number {
  return 2 * o.comm + (o.spread || 0);
}

// Giorno di ingresso = chiusura del giorno del segnale. Uscita: massimo >= target (vinta),
// minimo <= stop (persa). Se nello stesso giorno toccano entrambi si assume la perdita (prudente).
// Non considera i gap di apertura oltre lo stop: la perdita reale puo' essere maggiore.
export function simula(
  cron: Barra[], trig: (i: number) => boolean, opz: OpzioniAnalisi, nonSovrapposti = true, maxGiorni = 40,
): Operazione[] {
  const n = cron.length, ops: Operazione[] = [];
  const cst = costoTotale(opz), target = opz.tp + cst;
  let i = 50;
  while (i < n - 1) {
    if (!trig(i)) { i++; continue; }
    const entry = cron[i].c;
    const su = entry * (1 + target / 100), giu = entry * (1 - opz.sl / 100);
    const limite = Math.min(n - 1, i + maxGiorni);
    let fine = -1, esito: "v" | "p" | "s" = "s";
    for (let j = i + 1; j <= limite; j++) {
      if (cron[j].l <= giu) { esito = "p"; fine = j; break; }
      if (cron[j].h >= su) { esito = "v"; fine = j; break; }
    }
    if (fine < 0) {
      if (i + maxGiorni > n - 1) { i++; continue; } // non ancora risolta: non conteggiata
      esito = "s"; fine = i + maxGiorni;
    }
    const ret = esito === "v" ? opz.tp : esito === "p" ? -opz.sl - cst : (cron[fine].c / entry - 1) * 100 - cst;
    ops.push({ i, fine, esito, ret, giorni: fine - i });
    i = nonSovrapposti ? fine + 1 : i + 1;
  }
  return ops;
}

export function giorniSegnale(c: number[], tipo: TipoBacktest): boolean[] {
  const out: boolean[] = new Array(c.length).fill(false);
  for (let i = 50; i < c.length; i++) out[i] = condizione(tipo, c, i);
  return out;
}

export function statOps(ops: Operazione[], giorniTotali = 0): StatOps {
  const n = ops.length;
  let v = 0, p = 0, s = 0, gv = 0, somma = 0, e = 1, picco = 1, dd = 0, inpos = 0;
  for (const o of ops) {
    if (o.esito === "v") { v++; gv += o.giorni; } else if (o.esito === "p") p++; else s++;
    somma += o.ret; inpos += o.giorni;
    e *= 1 + o.ret / 100; picco = Math.max(picco, e); dd = Math.max(dd, (picco - e) / picco);
  }
  const w = intervalloWilson95(v, n);
  return {
    n, vinti: v, persi: p, scaduti: s,
    pct: n ? (v / n) * 100 : null, low: w ? w.low : null, high: w ? w.high : null,
    giorniMedi: v ? gv / v : null,
    attesa: n ? somma / n : null, composto: n ? (e - 1) * 100 : null, maxDD: n ? dd * 100 : null,
    tempoInvestito: n && giorniTotali > 0 ? (inpos / giorniTotali) * 100 : null,
  };
}

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// Confronto con entrate CASUALI (stessa frequenza di segnali, stessi costi e stesse regole di uscita).
// pValue = quota di prove casuali che fanno almeno altrettanto bene del segnale reale.
export function confrontoCaso(
  cron: Barra[], giorni: boolean[], opz: OpzioniAnalisi, pctReale: number, prove = 200,
): { pValue: number; mediaCaso: number } | null {
  const n = cron.length;
  let cand = 0;
  for (let i = 50; i < n - 1; i++) if (giorni[i]) cand++;
  if (cand === 0) return null;
  const freq = cand / (n - 51);
  const rnd = lcg(n * 7919 + cron[n - 1].d.length * 31 + Math.round(cron[n - 1].c * 100));
  let migliori = 0, somma = 0, valide = 0;
  for (let r = 0; r < prove; r++) {
    const ops = simula(cron, () => rnd() < freq, opz, true);
    if (!ops.length) continue;
    const win = (ops.filter((o) => o.esito === "v").length / ops.length) * 100;
    somma += win; valide++;
    if (win >= pctReale) migliori++;
  }
  if (!valide) return null;
  return { pValue: (migliori + 1) / (valide + 1), mediaCaso: somma / valide };
}

export type Livello = "alta" | "media" | "bassa" | "insufficiente";

export interface Valutazione extends StatOps {
  prima: { n: number; pct: number | null };
  oos: { n: number; pct: number | null };
  anni: { anno: string; n: number; pct: number }[];
  anniPositivi: number; anniTotali: number;
  vsCaso: { pValue: number; mediaCaso: number } | null;
  affidabilita: Livello;
  motivi: string[];
}

function pctDi(ops: Operazione[]): number | null {
  return ops.length ? (ops.filter((o) => o.esito === "v").length / ops.length) * 100 : null;
}

export function valuta(cron: Barra[], tipo: TipoBacktest, opz: OpzioniAnalisi, datiOk = true): Valutazione {
  const c = cron.map((x) => x.c);
  const giorni = giorniSegnale(c, tipo);
  const ops = simula(cron, (i) => giorni[i], opz, true);
  const st = statOps(ops, cron.length - 50);
  const soglia = cron.length - GIORNI_OOS;
  const prima = ops.filter((o) => o.i < soglia), oos = ops.filter((o) => o.i >= soglia);
  const perAnno = new Map<string, Operazione[]>();
  for (const o of ops) {
    const a = cron[o.i].d.slice(0, 4);
    if (!perAnno.has(a)) perAnno.set(a, []);
    perAnno.get(a)!.push(o);
  }
  const anni: { anno: string; n: number; pct: number }[] = [];
  let positivi = 0;
  for (const [anno, lista] of perAnno) {
    if (lista.length < 3) continue;
    anni.push({ anno, n: lista.length, pct: pctDi(lista)! });
    if (lista.reduce((s, o) => s + o.ret, 0) > 0) positivi++;
  }
  anni.sort((a, b) => (a.anno < b.anno ? -1 : 1));
  const vsCaso = st.pct !== null && st.n >= 10 ? confrontoCaso(cron, giorni, opz, st.pct) : null;

  const motivi: string[] = [];
  let livello: Livello;
  const oosContro = oos.length >= 5 && pctDi(oos)! < st.pct! - 25;
  if (st.n < 10) {
    livello = "insufficiente"; motivi.push("meno di 10 casi storici: troppo pochi per concludere");
  } else {
    if (vsCaso && vsCaso.pValue > 0.2) motivi.push("non batte in modo netto le entrate casuali");
    if (st.attesa !== null && st.attesa <= 0) motivi.push("rendimento medio per operazione non positivo");
    if (oosContro) motivi.push("negli ultimi 12 mesi è andata molto peggio che in passato");
    if (!datiOk) motivi.push("dati con anomalie");
    const bassa = motivi.length > 0;
    const alta = !bassa && st.n >= 30 && vsCaso !== null && vsCaso.pValue < 0.05 && (st.attesa || 0) > 0;
    livello = bassa ? "bassa" : alta ? "alta" : "media";
    if (livello === "media") motivi.push(st.n < 30 ? "casi ancora pochi (meno di 30)" : "vantaggio sul caso non netto");
    if (livello === "alta") motivi.push("30+ casi, batte il caso, rendimento medio positivo");
  }
  return {
    ...st,
    prima: { n: prima.length, pct: pctDi(prima) },
    oos: { n: oos.length, pct: pctDi(oos) },
    anni, anniPositivi: positivi, anniTotali: anni.length,
    vsCaso, affidabilita: livello, motivi,
  };
}

// Statistiche con parametri standard (8/8/0.2): usate per il registro dei segnali e per i dati aggregati.
export function statisticheStandard(barre: Barra[]): { trend: StatOps; ribasso: StatOps } {
  const cron = barre.slice().reverse();
  const c = cron.map((x) => x.c);
  const f = (t: TipoBacktest) => {
    const g = giorniSegnale(c, t);
    return statOps(simula(cron, (i) => g[i], STANDARD, true), cron.length - 50);
  };
  return { trend: f("trend"), ribasso: f("ribasso") };
}

// Valuta un segnale passato (data = giorno del segnale) con le regole standard.
export function valutaSegnale(
  barre: Barra[], data: string,
): { esito: "vinto" | "perso" | "scaduto"; data_esito: string; giorni: number; rendimento: number } | null {
  const cron = barre.slice().reverse();
  const idx = cron.findIndex((b) => b.d === data);
  if (idx < 50 || idx >= cron.length - 1) return null;
  const ops = simula(cron, (i) => i === idx, STANDARD, true);
  if (!ops.length) return null;
  const o = ops[0];
  return {
    esito: o.esito === "v" ? "vinto" : o.esito === "p" ? "perso" : "scaduto",
    data_esito: cron[o.fine].d, giorni: o.giorni, rendimento: o.ret,
  };
}

// =========================================================================
// QUALITA' DEI DATI E FILTRO DI MERCATO
// =========================================================================
export interface QualitaDati { ok: boolean; gravi: boolean; avvisi: string[] }

export function controllaDati(rec: Barra[], oggi: Date = new Date()): QualitaDati {
  const avvisi: string[] = [];
  let gravi = false;
  const ultima = new Date(rec[0].d + "T00:00:00Z").getTime();
  const eta = Math.floor((oggi.getTime() - ultima) / 86400000);
  if (eta > 10) { avvisi.push("Ultimo prezzo di " + eta + " giorni fa: dati molto vecchi"); gravi = true; }
  else if (eta > 5) avvisi.push("Ultimo prezzo di " + eta + " giorni fa");
  let buchi = 0, salti = 0, incoerenti = 0, disordine = false;
  // Controllo sugli ultimi ~5 anni (1300 barre): anomalie remote in uno storico lungo non devono bloccare l'analisi
  const ultimiK = Math.min(rec.length - 1, 1300);
  for (let k = 0; k < ultimiK; k++) {
    const a = new Date(rec[k].d + "T00:00:00Z").getTime(), b = new Date(rec[k + 1].d + "T00:00:00Z").getTime();
    if (!(a > b)) disordine = true;
    if ((a - b) / 86400000 > 10) buchi++;
    const salto = Math.abs(rec[k].c / rec[k + 1].c - 1);
    if (salto >= 0.45) { salti++; avvisi.push("Variazione di " + (salto * 100).toFixed(0) + "% in un giorno (" + rec[k].d + "): possibile frazionamento non corretto"); }
    if (rec[k].h < rec[k].l || rec[k].c > rec[k].h * 1.01 || rec[k].c < rec[k].l * 0.99) incoerenti++;
  }
  if (disordine) { avvisi.push("Date duplicate o non ordinate nello storico"); gravi = true; }
  if (buchi > 0) { avvisi.push(buchi + (buchi === 1 ? " buco" : " buchi") + " di oltre 10 giorni nello storico"); if (buchi > 3) gravi = true; }
  if (incoerenti > 5) { avvisi.push("Prezzi incoerenti in " + incoerenti + " giorni"); gravi = true; }
  if (salti > 0) gravi = true;
  return { ok: avvisi.length === 0, gravi, avvisi };
}

export interface StatoMercato { ticker: string; prezzo: number; sma200: number; distanza: number; sopraSma200: boolean }

export function statoMercato(barre: Barra[], ticker = "SPY"): StatoMercato | null {
  if (!barre || barre.length < 200) return null;
  const c = barre.map((x) => x.c); // dal piu' recente
  const sma200 = media(c.slice(0, 200));
  return { ticker, prezzo: c[0], sma200, distanza: (c[0] / sma200 - 1) * 100, sopraSma200: c[0] > sma200 };
}

function maxDrawdown(c: number[]): number {
  let picco = c[0], dd = 0;
  for (const x of c) { picco = Math.max(picco, x); dd = Math.max(dd, (picco - x) / picco); }
  return dd * 100;
}

// ---- analisi completa di un titolo ----
export function analizzaSerie(
  barre: Barra[], opz: OpzioniAnalisi, extra: { mercato?: StatoMercato | null; oggi?: Date } = {},
) {
  if (!barre || barre.length < 60) return null;
  const rec = barre;
  const cron = rec.slice().reverse();
  const c = cron.map((x) => x.c), h = cron.map((x) => x.h), l = cron.map((x) => x.l), v = cron.map((x) => x.v);
  const i = c.length - 1;
  const prezzo = c[i];
  const sma50 = smaAt(c, i, 50)!;
  const sma200 = c.length >= 200 ? smaAt(c, i, 200) : null;
  const distanza = (prezzo / sma50 - 1) * 100;
  const rsi = rsiAt(c, i, 14);
  const atr14 = atrAt(h, l, c, i, 14);
  const adx14 = calcolaADX(rec.map((x) => x.h), rec.map((x) => x.l), rec.map((x) => x.c), 14);
  const volume = rapportoVolume(v);
  const trend3 = trendConfermato(c);
  const volumeConfermato = volume === null ? null : volume > 1.2;
  const confermato = trend3 === true && volumeConfermato !== false;

  let punteggio = 0;
  if (prezzo > sma50) punteggio++;
  if (sma200 !== null && prezzo > sma200) punteggio++;
  if (rsi !== null && rsi >= 50 && rsi <= 70) punteggio++;
  if (adx14 !== null && adx14 >= 20) punteggio++;

  let stato: "ipervenduto" | "forte" | "neutro" | "debole";
  if (rsi !== null && rsi < 35 && prezzo < sma50) stato = "ipervenduto";
  else if (punteggio >= 3 && confermato) stato = "forte";
  else if (punteggio >= 2) stato = "neutro";
  else stato = "debole";

  const cst = costoTotale(opz);
  const target = opz.tp + cst;
  const serie: { d: string; c: number; s: number | null }[] = [];
  for (let k = Math.max(0, c.length - 90); k < c.length; k++) {
    serie.push({ d: cron[k].d, c: c[k], s: smaAt(c, k, 50) });
  }

  const qualita = controllaDati(rec, extra.oggi || new Date());
  const avvisi: string[] = qualita.avvisi.slice();
  const mercato = extra.mercato || null;
  if (mercato && !mercato.sopraSma200 && (stato === "forte" || stato === "ipervenduto")) {
    avvisi.push("Mercato generale (" + mercato.ticker + ") sotto la media a 200 giorni: rischio più alto per i segnali di acquisto");
  }
  const datiOk = !qualita.gravi;
  const bt = valuta(cron, "trend", opz, datiOk);
  const rib = valuta(cron, "ribasso", opz, datiOk);

  const base = Math.max(50, c.length - GIORNI_OOS);
  const buyHold = {
    rendimento: (c[i] / c[50] - 1) * 100,
    maxDD: maxDrawdown(c.slice(50)),
    rendimentoOos: (c[i] / c[base] - 1) * 100,
    maxDDOos: maxDrawdown(c.slice(base)),
  };

  return {
    ultima: cron[i].d,
    prezzo, sma50, sma200, distanza, rsi,
    atr14,
    atrPct: atr14 !== null ? (atr14 / prezzo) * 100 : null,
    stopAtr: atr14 !== null ? prezzo - 2 * atr14 : null, // riferito al prezzo di oggi
    adx14, volume, volumeConfermato, trend3, confermato,
    punteggio, stato,
    targetPct: target,
    prezzoTarget: prezzo * (1 + target / 100),
    prezzoStop: prezzo * (1 - opz.sl / 100),
    backtest: bt,
    backtestRib: rib,
    buyHold,
    qualita: { ok: qualita.ok, gravi: qualita.gravi },
    mercato,
    avvisi,
    giorniStorico: c.length,
    serie,
  };
}
