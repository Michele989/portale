// =========================================================================
// VALIDAZIONE sull'intero universo (funzioni pure; il lavoro e' lanciato da GitHub Actions).
//
// Domanda a cui risponde: "le regole del programma battono davvero il caso, anche fuori campione?"
//  1) REGOLE (forte / ipervenduto): per ogni data, il rendimento a orizzonte fisso dei titoli in quello stato
//     si confronta con la media di TUTTI i titoli nella stessa data ("eccesso"): cosi' i giorni di mercato in
//     crollo o in rialzo non falsano il risultato. Ingresso all'apertura di T+1, uscita alla chiusura di T+h.
//  2) PROBABILITA' (modello "simili" contro "base"): stima ripetuta nel tempo usando SOLO rendimenti gia'
//     conclusi a ogni data (nessun dato futuro); si misura il punteggio di Brier e il BSS (>0 = meglio della base).
//  Incertezza: bootstrap a blocchi di DATE (tutti i titoli di una data restano insieme; blocchi lunghi quanto
//  l'orizzonte) per rispettare sovrapposizione e correlazione. Con piu' test: correzione di Holm.
//  Le regole NON sono state ottimizzate su questi dati: il periodo recente (ultimo 40%) e' una verifica di stabilita'.
// =========================================================================
import type { Barra } from "./analisi.ts";
import { mulberry32, probSimili, rendFuturi, seme, serieStati, MIN_CASI_SIMILI, MIN_INDIP_BASE } from "./previsioni.ts";
import type { StatoGiorno } from "./previsioni.ts";
import { rendimentiGiornalieri, stimaGarch, varianzaAttesaMedia } from "./garch.ts";
import { fitCalibrazione } from "./calibrazione.ts";

export const VERSIONE_VALIDAZIONE = "v1.0";
export interface SerieTitolo { ticker: string; cron: Barra[] } // cron: dal piu' vecchio al piu' recente

type Regola = "forte" | "ipervenduto";
const REGOLE: Regola[] = ["forte", "ipervenduto"];

interface Blocchi { x: Float64Array; n: Float64Array } // somme per data (eccesso rendimento, numero osservazioni)

// ---------- bootstrap a blocchi circolari su somme per data (stimatore rapporto di somme) ----------
export function bootstrapRapporto(num: Float64Array, den: Float64Array, L: number, B: number, rnd: () => number): { media: number | null; campioni: number[] } {
  const m = num.length;
  let sn = 0, sd = 0;
  for (let i = 0; i < m; i++) { sn += num[i]; sd += den[i]; }
  if (m < 2 || sd <= 0) return { media: null, campioni: [] };
  const P = new Float64Array(2 * m + 1), Q = new Float64Array(2 * m + 1);
  for (let i = 0; i < 2 * m; i++) { P[i + 1] = P[i] + num[i % m]; Q[i + 1] = Q[i] + den[i % m]; }
  const Lb = Math.max(1, Math.min(L, m));
  const nb = Math.max(1, Math.floor(m / Lb));
  const camp: number[] = [];
  for (let b = 0; b < B; b++) {
    let a = 0, d = 0;
    for (let k = 0; k < nb; k++) {
      const s = Math.floor(rnd() * m);
      a += P[s + Lb] - P[s]; d += Q[s + Lb] - Q[s];
    }
    if (d > 0) camp.push(a / d);
  }
  return { media: sn / sd, campioni: camp };
}

function percentile(v: number[], q: number): number {
  const o = v.slice().sort((a, b) => a - b);
  if (!o.length) return NaN;
  const pos = (o.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return o[lo] + (o[hi] - o[lo]) * (pos - lo);
}
const arr = (v: number) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

function sommario(num: Float64Array, den: Float64Array, L: number, B: number, rnd: () => number) {
  const b = bootstrapRapporto(num, den, L, B, rnd);
  if (b.media === null || b.campioni.length < 50) return { media: null, ci95: null, pUnilat: null, osservazioni: 0, date: num.length };
  const p = b.campioni.filter((x) => x <= 0).length / b.campioni.length; // quota di ricampionamenti senza vantaggio
  let oss = 0; for (let i = 0; i < den.length; i++) oss += den[i];
  return { media: arr(b.media), ci95: [arr(percentile(b.campioni, 0.025)), arr(percentile(b.campioni, 0.975))] as [number | null, number | null], pUnilat: Math.max(p, 1 / (b.campioni.length + 1)), osservazioni: Math.round(oss), date: num.length };
}

// Holm: p corretti per test multipli
export function holm(p: (number | null)[]): (number | null)[] {
  const idx = p.map((x, i) => ({ x, i })).filter((o) => o.x !== null).sort((a, b) => (a.x as number) - (b.x as number));
  const out: (number | null)[] = p.map(() => null);
  const m = idx.length;
  let massimo = 0;
  idx.forEach((o, k) => { massimo = Math.max(massimo, Math.min(1, (m - k) * (o.x as number))); out[o.i] = massimo; });
  return out;
}


// ---------- barriere in multipli di ATR (obiettivo e stop che si adattano alla vivacita' del titolo) ----------
function atrSerie(cron: Barra[], p = 14): (number | null)[] {
  const n = cron.length, out: (number | null)[] = new Array(n).fill(null);
  if (n <= p) return out;
  const tr = (i: number) => Math.max(cron[i].h - cron[i].l, Math.abs(cron[i].h - cron[i - 1].c), Math.abs(cron[i].l - cron[i - 1].c));
  let a = 0; for (let i = 1; i <= p; i++) a += tr(i); a /= p; out[p] = a;
  for (let i = p + 1; i < n; i++) { a = (a * (p - 1) + tr(i)) / p; out[i] = a; }
  return out;
}
export const ATR_K = 2, ATR_GIORNI = 40;
// +1 obiettivo raggiunto per primo, -1 stop (anche se nello stesso giorno), 0 nessuno dei due entro ATR_GIORNI
function punteggioBarriere(cron: Barra[], i: number, atr: number): number {
  const e = cron[i + 1]; const ingresso = e.o && e.o > 0 ? e.o : e.c;
  const tgt = ingresso + ATR_K * atr, stp = ingresso - ATR_K * atr;
  for (let j = i + 1; j <= Math.min(i + ATR_GIORNI, cron.length - 1); j++) {
    if (cron[j].l <= stp) return -1;
    if (cron[j].h >= tgt) return 1;
  }
  return 0;
}

// ---------- White's Reality Check: il MIGLIORE di molti test e' davvero meglio del caso? ----------
export function realityCheck(casi: { nome: string; num: Float64Array; den: Float64Array }[], L: number, B: number, rnd: () => number) {
  const ok = casi.filter((c) => { let d = 0; for (let i = 0; i < c.den.length; i++) d += c.den[i]; return d > 0; });
  if (ok.length < 2) return null;
  const m = ok[0].num.length, Lb = Math.max(1, Math.min(L, m)), nb = Math.max(1, Math.floor(m / Lb));
  const P = ok.map((c) => { const a = new Float64Array(2 * m + 1); for (let i = 0; i < 2 * m; i++) a[i + 1] = a[i] + c.num[i % m]; return a; });
  const Q = ok.map((c) => { const a = new Float64Array(2 * m + 1); for (let i = 0; i < 2 * m; i++) a[i + 1] = a[i] + c.den[i % m]; return a; });
  const mu = ok.map((c) => { let a = 0, d = 0; for (let i = 0; i < m; i++) { a += c.num[i]; d += c.den[i]; } return a / d; });
  const camp: number[][] = ok.map(() => []);
  for (let b = 0; b < B; b++) {
    const starts: number[] = []; for (let k = 0; k < nb; k++) starts.push(Math.floor(rnd() * m));
    ok.forEach((_, j) => { let a = 0, d = 0; for (const s0 of starts) { a += P[j][s0 + Lb] - P[j][s0]; d += Q[j][s0 + Lb] - Q[j][s0]; } camp[j].push(d > 0 ? a / d : 0); });
  }
  const se = camp.map((v, j) => { const mm = v.reduce((x, y) => x + y, 0) / v.length; return Math.sqrt(v.reduce((x, y) => x + (y - mm) ** 2, 0) / v.length) || 1e-12; });
  let tOss = -Infinity, mig = 0;
  mu.forEach((x, j) => { const t = x / se[j]; if (t > tOss) { tOss = t; mig = j; } });
  let sopra = 0;
  for (let b = 0; b < B; b++) { let mx = -Infinity; for (let j = 0; j < ok.length; j++) mx = Math.max(mx, (camp[j][b] - mu[j]) / se[j]); if (mx >= tOss) sopra++; }
  return { test: ok.length, migliore: ok[mig].nome, statistica: arr(tOss), pValore: (sopra + 1) / (B + 1) };
}

// ---------- PIT e CRPS: la distribuzione storica del titolo descrive bene i rendimenti futuri? ----------
function fPhi(z: number) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }
function fCdf(z: number) { // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = fPhi(z);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
function pitCrps(prep: { ticker: string; cron: Barra[] }[], h: number, maxTitoli = 100, passo = 10) {
  const idonei = prep.filter((t) => t.cron.length >= 5 * h + 300);
  const salto = Math.max(1, Math.ceil(idonei.length / maxTitoli));
  const pit = new Array(10).fill(0); let n = 0, cE = 0, cN = 0;
  for (let k = 0; k < idonei.length; k += salto) {
    const cron = idonei[k].cron, r = rendFuturi(cron, h);
    const ord: number[] = []; let somma = 0, sq = 0, aggiunti = 0;
    for (let t = 0; t < cron.length - h; t++) {
      const s = t - h; // il rendimento che parte in s e' noto da s+h = t in poi
      if (s >= 0 && s >= aggiunti) {
        for (; aggiunti <= s; aggiunti++) {
          const x = r[aggiunti] as number; let lo = 0, hi = ord.length;
          while (lo < hi) { const md = (lo + hi) >> 1; if (ord[md] < x) lo = md + 1; else hi = md; }
          ord.splice(lo, 0, x); somma += x; sq += x * x;
        }
      }
      if (t % passo !== 0 || ord.length < Math.max(5 * h, 250)) continue;
      const y = r[t] as number, m = ord.length;
      let minori = 0, uguali = 0, assoluto = 0, doppia = 0;
      for (let i = 0; i < m; i++) { const x = ord[i]; if (x < y) minori++; else if (x === y) uguali++; assoluto += Math.abs(x - y); doppia += (2 * i - m + 1) * x; }
      pit[Math.min(9, Math.floor(((minori + uguali / 2) / m) * 10))]++;
      cE += assoluto / m - (doppia / (m * m));
      const mu = somma / m, sd = Math.sqrt(Math.max(1e-12, sq / m - mu * mu)), z = (y - mu) / sd;
      cN += sd * (z * (2 * fCdf(z) - 1) + 2 * fPhi(z) - 1 / Math.sqrt(Math.PI));
      n++;
    }
  }
  if (n < 100) return null;
  const quote = pit.map((x) => arr(x / n));
  const attesa = 0.1; const chi = pit.reduce((a, x) => a + ((x / n - attesa) ** 2) / attesa, 0) * n;
  return { orizzonte: h, osservazioni: n, pit_decimi: quote, chi_quadro_uniformita: arr(chi), crps_empirica: arr(cE / n), crps_normale: arr(cN / n), skill_vs_normale: arr(1 - cE / cN) };
}

// ---------- qualita' dei dati sull'intero universo ----------
export function reportQualita(prep: { ticker: string; cron: Barra[] }[]) {
  const per: any[] = [];
  for (const t of prep) {
    const c = t.cron, n = c.length; let buchi = 0, salti = 0, incoerenti = 0, zeroVol = 0, fermi = 0, serie = 1, aperturaFuori = 0;
    for (let i = 1; i < n; i++) {
      const gg = (Date.parse(c[i].d) - Date.parse(c[i - 1].d)) / 86400000;
      if (gg > 10) buchi++;
      if (Math.abs(c[i].c / c[i - 1].c - 1) >= 0.4) salti++;
      if (c[i].h < c[i].l || c[i].c > c[i].h * 1.01 || c[i].c < c[i].l * 0.99) incoerenti++;
      if (c[i].o && (c[i].o as number > c[i].h * 1.01 || (c[i].o as number) < c[i].l * 0.99)) aperturaFuori++;
      if (c[i].c === c[i - 1].c) { serie++; fermi = Math.max(fermi, serie); } else serie = 1;
    }
    for (let i = Math.max(0, n - 250); i < n; i++) if (!(c[i].v > 0)) zeroVol++;
    const problemi = buchi + salti + incoerenti + aperturaFuori + (fermi >= 8 ? 1 : 0) + (zeroVol > 60 ? 1 : 0);
    if (problemi) per.push({ ticker: t.ticker, buchi, salti_oltre_40pct: salti, barre_incoerenti: incoerenti, apertura_fuori_range: aperturaFuori, giorni_fermi_max: fermi, giorni_senza_volume_ultimo_anno: zeroVol, problemi });
  }
  per.sort((a, b) => b.problemi - a.problemi);
  return { titoli: prep.length, con_anomalie: per.length, esempi: per.slice(0, 15) };
}

// ---------- La previsione di volatilita' (GARCH) e' davvero migliore di alternative semplici? ----------
// Perdita QLIKE (robusta): piu' bassa = meglio. Confronto GARCH contro volatilita' degli ultimi 63 giorni e contro quella di lungo periodo.
function testVolatilita(prep: { ticker: string; cron: Barra[] }[], per: Map<string, number>, D: number, rnd: () => number, B: number, h = 21, passo = 126, maxTitoli = 120) {
  const qlike = (previsto: number, reale: number) => { const x = reale / previsto; return x - Math.log(x) - 1; };
  const idonei = prep.filter((t) => t.cron.length >= 900);
  const salto = Math.max(1, Math.ceil(idonei.length / maxTitoli));
  const numT = new Float64Array(D), numL = new Float64Array(D), den = new Float64Array(D);
  let nPrev = 0, sG = 0, sT = 0, sL = 0;
  for (let k = 0; k < idonei.length; k += salto) {
    const t = idonei[k];
    const r = rendimentiGiornalieri(t.cron.map((x) => x.c));
    for (let i = 750; i + h <= r.length; i += passo) {
      const p = stimaGarch(r.slice(Math.max(0, i - 1500), i));
      if (!p) continue;
      const fG = varianzaAttesaMedia(p, h);
      let vt = 0; for (let j = i - 63; j < i; j++) vt += r[j] * r[j]; vt /= 63;
      let vl = 0; for (let j = 0; j < i; j++) vl += r[j] * r[j]; vl /= i;
      let real = 0; for (let j = i; j < i + h; j++) real += r[j] * r[j]; real /= h;
      if (!(real > 0) || !(vt > 0) || !(vl > 0) || !(fG > 0)) continue;
      const qG = qlike(fG, real), qT = qlike(vt, real), qL = qlike(vl, real);
      const di = per.get(t.cron[i].d) as number;
      numT[di] += qT - qG; numL[di] += qL - qG; den[di] += 1;
      nPrev++; sG += qG; sT += qT; sL += qL;
    }
  }
  if (nPrev < 50) return { previsioni: nPrev, utile: false, nota: "campione insufficiente" };
  const vsT = sommario(numT, den, h, B, rnd), vsL = sommario(numL, den, h, B, rnd);
  const utile = !!(vsT.ci95 && vsT.ci95[0] !== null && vsT.ci95[0] > 0 && vsL.ci95 && vsL.ci95[0] !== null && vsL.ci95[0] > 0);
  return { previsioni: nPrev, orizzonte: h, qlike_medio: { garch: arr(sG / nPrev), ultimi63: arr(sT / nPrev), lungo_periodo: arr(sL / nPrev) }, vantaggio_vs_ultimi63: vsT, vantaggio_vs_lungo_periodo: vsL, utile };
}


export function validazioneCompleta(serie: SerieTitolo[], spy: Barra[] | null, opz: { B?: number; seed?: string; orizzonti?: number[]; passoProb?: number } = {}) {
  const B = opz.B ?? 1500;
  const orizzonti = opz.orizzonti ?? [21, 63, 252];
  const rnd = mulberry32(seme(opz.seed ?? "validazione"));
  // indice delle date (unione ordinata)
  const setDate = new Set<string>();
  for (const s of serie) for (const b of s.cron) setDate.add(b.d);
  const date = [...setDate].sort();
  const per = new Map<string, number>(); date.forEach((d, i) => per.set(d, i));
  const D = date.length;
  // regime di mercato per data: SPY sopra la media a 200 giorni
  const sopra = new Int8Array(D).fill(-1);
  if (spy && spy.length > 210) {
    let cum = 0; const c = spy.map((b) => b.c);
    const pre: number[] = [0]; for (const x of c) { cum += x; pre.push(cum); }
    for (let i = 199; i < spy.length; i++) { const sma = (pre[i + 1] - pre[i - 199]) / 200; const k = per.get(spy[i].d); if (k !== undefined) sopra[k] = c[i] > sma ? 1 : 0; }
  }
  const prep = serie.map((s) => ({ ticker: s.ticker, cron: s.cron, stati: serieStati(s.cron) }));
  const anniDate = date.map((d) => d.slice(0, 4));
  const taglio = Math.floor(D * 0.6); // fino qui "sviluppo", poi "recente"

  const regole: any[] = [];
  const casiRC: { nome: string; num: Float64Array; den: Float64Array }[] = [];
  for (const h of orizzonti) {
    // passo 1: media di tutti i titoli per data (rendimento e quota di rialzi)
    const sAll = new Float64Array(D), nAll = new Float64Array(D), uAll = new Float64Array(D);
    const rr = prep.map((t) => rendFuturi(t.cron, h));
    prep.forEach((t, k) => {
      for (let i = 0; i < t.cron.length; i++) {
        const r = rr[k][i]; if (r === null) continue;
        const di = per.get(t.cron[i].d) as number;
        sAll[di] += r; nAll[di] += 1; uAll[di] += r > 0 ? 1 : 0;
      }
    });
    // passo 2: eccesso dei titoli nello stato rispetto alla media della data
    for (const regola of REGOLE) {
      const ex = new Float64Array(D), ey = new Float64Array(D), nn = new Float64Array(D);
      const exS = new Float64Array(D); // eccesso nel mercato "sopra / sotto"
      prep.forEach((t, k) => {
        for (let i = 0; i < t.cron.length; i++) {
          const r = rr[k][i]; if (r === null || t.stati[i] !== regola) continue;
          const di = per.get(t.cron[i].d) as number;
          if (nAll[di] < 10) continue; // date con pochi titoli: media poco affidabile
          ex[di] += r - sAll[di] / nAll[di];
          ey[di] += (r > 0 ? 1 : 0) - uAll[di] / nAll[di];
          nn[di] += 1;
        }
      });
      void exS;
      casiRC.push({ nome: regola + "/" + h + "g", num: ex, den: nn });
      const tot = sommario(ex, nn, h, B, rnd);
      const totY = sommario(ey, nn, h, Math.floor(B / 2), rnd);
      const part = (a: number, b: number) => sommario(ex.slice(a, b), nn.slice(a, b), h, Math.floor(B / 2), rnd);
      const sviluppo = part(0, taglio), recente = part(taglio, D);
      // per anno e per regime di mercato (medie semplici, indicative)
      const anni: any[] = [];
      let a0 = 0;
      for (let i = 1; i <= D; i++) if (i === D || anniDate[i] !== anniDate[a0]) {
        let sx = 0, sn = 0; for (let j = a0; j < i; j++) { sx += ex[j]; sn += nn[j]; }
        if (sn >= 20) anni.push({ anno: anniDate[a0], media: arr(sx / sn), osservazioni: Math.round(sn) });
        a0 = i;
      }
      const reg: Record<string, any> = {};
      for (const [nome, v] of [["mercato_sopra_sma200", 1], ["mercato_sotto_sma200", 0]] as const) {
        let sx = 0, sn = 0; for (let j = 0; j < D; j++) if (sopra[j] === v) { sx += ex[j]; sn += nn[j]; }
        reg[nome] = sn >= 20 ? { media: arr(sx / sn), osservazioni: Math.round(sn) } : null;
      }
      regole.push({ regola, orizzonte: h, ...tot, eccesso_quota_rialzi_pp: totY.media === null ? null : arr((totY.media as number) * 100), sviluppo, recente, anni, regime: reg });
    }
  }

  // ---- barriere ATR: obiettivo e stop a +/- ATR_K volte l'ATR14 del titolo, entro ATR_GIORNI sedute ----
  {
    const atrT = prep.map((t) => atrSerie(t.cron));
    const punt = prep.map((t, k) => {
      const out = new Float32Array(t.cron.length).fill(NaN);
      for (let i = 20; i + 1 < t.cron.length - ATR_GIORNI; i += 3) { const a = atrT[k][i]; if (a && a > 0) out[i] = punteggioBarriere(t.cron, i, a); }
      return out;
    });
    const sA = new Float64Array(D), nA = new Float64Array(D);
    prep.forEach((t, k) => { for (let i = 0; i < t.cron.length; i++) { const x = punt[k][i]; if (!Number.isNaN(x)) { const di = per.get(t.cron[i].d) as number; sA[di] += x; nA[di] += 1; } } });
    for (const regola of REGOLE) {
      const ex = new Float64Array(D), nn = new Float64Array(D);
      prep.forEach((t, k) => { for (let i = 0; i < t.cron.length; i++) { const x = punt[k][i]; if (Number.isNaN(x) || t.stati[i] !== regola) continue; const di = per.get(t.cron[i].d) as number; if (nA[di] < 10) continue; ex[di] += x - sA[di] / nA[di]; nn[di] += 1; } });
      casiRC.push({ nome: regola + "/ATR", num: ex, den: nn });
      const tot = sommario(ex, nn, ATR_GIORNI, B, rnd);
      const part = (a: number, b: number) => sommario(ex.slice(a, b), nn.slice(a, b), ATR_GIORNI, Math.floor(B / 2), rnd);
      regole.push({ regola, orizzonte: ATR_GIORNI, misura: "barriere_atr", atr_k: ATR_K, ...tot, sviluppo: part(0, taglio), recente: part(taglio, D), anni: [], regime: {} });
    }
  }
  const rc = realityCheck(casiRC, 63, Math.floor(B / 2), rnd);
  const ph = holm(regole.map((r) => r.pUnilat));
  regole.forEach((r, i) => { r.pHolm = ph[i] === null ? null : arr(ph[i] as number); });

  // ---- probabilita': "simili" contro "base" ripetute nel tempo (solo dati gia' conclusi) ----
  const passo = opz.passoProb ?? 5;
  const probabilita: any[] = [];
  const calibLineare: any[] = [];
  for (const h of orizzonti.filter((x) => x !== 252)) {
    const PS: number[] = [], PB: number[] = [], YY: number[] = [];
    const num = new Float64Array(D), numB = new Float64Array(D), den = new Float64Array(D);
    const fasce = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0, pb: 0 }));
    for (const t of prep) {
      const r = rendFuturi(t.cron, h);
      const n = t.cron.length;
      const upC = new Int32Array(n + 1);
      const stC: Record<string, { n: Int32Array; u: Int32Array }> = {};
      for (const s of ["forte", "ipervenduto", "neutro", "debole"]) stC[s] = { n: new Int32Array(n + 1), u: new Int32Array(n + 1) };
      for (let i = 0; i < n; i++) {
        const x = r[i];
        upC[i + 1] = upC[i] + (x !== null && x > 0 ? 1 : 0);
        for (const s of Object.keys(stC)) {
          const hit = x !== null && t.stati[i] === s;
          stC[s].n[i + 1] = stC[s].n[i] + (hit ? 1 : 0);
          stC[s].u[i + 1] = stC[s].u[i] + (hit && (x as number) > 0 ? 1 : 0);
        }
      }
      for (let i = 0; i < n - h; i += passo) {
        const y = (r[i] as number) > 0 ? 1 : 0;
        const noti = i - h + 1; // rendimenti s = 0..i-h gia' conclusi
        if (noti < 1 || Math.floor(noti / h) < MIN_INDIP_BASE) continue;
        const stato = t.stati[i] as StatoGiorno;
        if (stato === "nd") continue;
        const sc = stC[stato];
        const nC = sc.n[i - h + 1], uC = sc.u[i - h + 1];
        if (nC < MIN_CASI_SIMILI) continue;
        const pB = upC[i - h + 1] / noti;
        const pS = probSimili(uC / nC, nC, pB, h);
        const di = per.get(t.cron[i].d) as number;
        num[di] += (pS - y) ** 2; numB[di] += (pB - y) ** 2; den[di] += 1;
        const f = fasce[Math.min(9, Math.floor(pS * 10))]; f.n++; f.p += pS; f.y += y; f.pb += pB;
        PS.push(pS); PB.push(pB); YY.push(y);
      }
    }
    const bss = (a: number, b: number) => {
      const x = num.slice(a, b), xb = numB.slice(a, b), dn = den.slice(a, b);
      let sx = 0, sb = 0, so = 0; for (let i = 0; i < x.length; i++) { sx += x[i]; sb += xb[i]; so += dn[i]; }
      if (so < 30 || sb <= 0) return { bss: null, ci95: null, osservazioni: Math.round(so), date: x.length, pUnilat: null as number | null };
      // BSS = 1 - SommaBrier(simili)/SommaBrier(base); bootstrap sulle somme per data
      const m = x.length, Lb = Math.max(1, Math.min(h, m)), nb = Math.max(1, Math.floor(m / Lb));
      const camp: number[] = [];
      for (let k = 0; k < Math.floor(B / 2); k++) {
        let a1 = 0, b1 = 0;
        for (let j = 0; j < nb; j++) { const s = Math.floor(rnd() * m); for (let q = 0; q < Lb; q++) { const idx = (s + q) % m; a1 += x[idx]; b1 += xb[idx]; } }
        if (b1 > 0) camp.push(1 - a1 / b1);
      }
      const val = 1 - sx / sb;
      return { bss: arr(val), ci95: [arr(percentile(camp, 0.025)), arr(percentile(camp, 0.975))], osservazioni: Math.round(so), date: m, pUnilat: camp.filter((c) => c <= 0).length / Math.max(1, camp.length) };
    };
    const cS = fitCalibrazione(PS, YY, 0.5), cB = fitCalibrazione(PB, YY, 0.5);
    calibLineare.push({ orizzonte: h, simili: cS && { intercetta: arr(cS.a), pendenza: arr(cS.b) }, base: cB && { intercetta: arr(cB.a), pendenza: arr(cB.b) }, osservazioni: YY.length });
    probabilita.push({
      orizzonte: h, intero: bss(0, D), recente: bss(taglio, D),
      calibrazione: fasce.map((f, i) => f.n >= 50 ? { fascia: i, osservazioni: f.n, dichiarato: arr(100 * f.p / f.n), osservato: arr(100 * f.y / f.n), base: arr(100 * f.pb / f.n) } : null).filter(Boolean),
    });
  }

  const distribuzioni = orizzonti.filter((x) => x !== 252).map((h) => pitCrps(prep, h)).filter(Boolean);
  const qualita_dati = reportQualita(prep);
  const volatilita = testVolatilita(prep, per, D, rnd, Math.floor(B / 2));

  // ---- conclusione automatica, prudente ----
  const vincenti = regole.filter((r) => r.pHolm !== null && r.pHolm < 0.05 && r.media > 0 && r.recente.media !== null && r.recente.media > 0 && r.recente.ci95 && r.recente.ci95[0] > 0);
  const probMeglio = probabilita.filter((p) => p.intero.bss !== null && p.intero.ci95 && p.intero.ci95[0] > 0 && p.recente.bss !== null && p.recente.bss > 0);
  const conclusione = vincenti.length || probMeglio.length
    ? "Vantaggio dimostrato (dopo correzione per test multipli e confermato nel periodo recente): " + [...vincenti.map((r) => r.regola + " a " + r.orizzonte + " giorni"), ...probMeglio.map((p) => "probabilita' simili a " + p.orizzonte + " giorni")].join("; ") + ". Resta valido solo per l'universo attuale (survivorship bias)."
    : "Nessun vantaggio dimostrabile: le regole e le probabilita' condizionate non battono in modo affidabile il confronto semplice, dopo la correzione per test multipli e la verifica sul periodo recente.";
  const conclusioneRischio = (volatilita as any).utile
    ? "Rischio: la previsione di volatilita' GARCH e' risultata migliore dei confronti semplici (ultimi 63 giorni e lungo periodo) fuori campione."
    : "Rischio: la previsione di volatilita' GARCH non e' risultata chiaramente migliore dei confronti semplici.";

  const dal = date[0], al = date[D - 1];
  return {
    versione: VERSIONE_VALIDAZIONE, generato: new Date().toISOString(),
    universo: { titoli: serie.length, dal, al, date: D, taglio_sviluppo_recente: date[taglio] },
    regole, realityCheck: rc, probabilita, calibrazione_lineare: calibLineare, distribuzioni, volatilita, qualita_dati, conclusione, conclusioneRischio,
    note: [
      "Ingresso all'apertura di T+1 quando disponibile, altrimenti alla chiusura di T+1; uscita alla chiusura di T+h. Nessun costo: i risultati sono rispetto alla media dei titoli della stessa data.",
      "Universo = titoli attuali del catalogo: i titoli usciti dal mercato mancano (survivorship bias), quindi i risultati tendono a essere ottimistici.",
      "Prezzi corretti per dividendi e split dal fornitore dati. Incertezza: bootstrap a blocchi di date; test multipli: correzione di Holm sulle regole.",
      "Le regole non sono state scelte guardando questi dati: 'recente' (ultimo 40% delle date) serve come verifica di stabilita'.",
    ],
  };
}
