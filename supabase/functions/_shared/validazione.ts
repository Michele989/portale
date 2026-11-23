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

interface Pannello { date: string[]; per: Map<string, number> }

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
  const ph = holm(regole.map((r) => r.pUnilat));
  regole.forEach((r, i) => { r.pHolm = ph[i] === null ? null : arr(ph[i] as number); });

  // ---- probabilita': "simili" contro "base" ripetute nel tempo (solo dati gia' conclusi) ----
  const passo = opz.passoProb ?? 5;
  const probabilita: any[] = [];
  for (const h of orizzonti.filter((x) => x !== 252)) {
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
    probabilita.push({
      orizzonte: h, intero: bss(0, D), recente: bss(taglio, D),
      calibrazione: fasce.map((f, i) => f.n >= 50 ? { fascia: i, osservazioni: f.n, dichiarato: arr(100 * f.p / f.n), osservato: arr(100 * f.y / f.n), base: arr(100 * f.pb / f.n) } : null).filter(Boolean),
    });
  }

  // ---- conclusione automatica, prudente ----
  const vincenti = regole.filter((r) => r.pHolm !== null && r.pHolm < 0.05 && r.media > 0 && r.recente.media !== null && r.recente.media > 0 && r.recente.ci95 && r.recente.ci95[0] > 0);
  const probMeglio = probabilita.filter((p) => p.intero.bss !== null && p.intero.ci95 && p.intero.ci95[0] > 0 && p.recente.bss !== null && p.recente.bss > 0);
  const conclusione = vincenti.length || probMeglio.length
    ? "Vantaggio dimostrato (dopo correzione per test multipli e confermato nel periodo recente): " + [...vincenti.map((r) => r.regola + " a " + r.orizzonte + " giorni"), ...probMeglio.map((p) => "probabilita' simili a " + p.orizzonte + " giorni")].join("; ") + ". Resta valido solo per l'universo attuale (survivorship bias)."
    : "Nessun vantaggio dimostrabile: le regole e le probabilita' condizionate non battono in modo affidabile il confronto semplice, dopo la correzione per test multipli e la verifica sul periodo recente.";

  const dal = date[0], al = date[D - 1];
  return {
    versione: VERSIONE_VALIDAZIONE, generato: new Date().toISOString(),
    universo: { titoli: serie.length, dal, al, date: D, taglio_sviluppo_recente: date[taglio] },
    regole, probabilita, conclusione,
    note: [
      "Ingresso all'apertura di T+1 quando disponibile, altrimenti alla chiusura di T+1; uscita alla chiusura di T+h. Nessun costo: i risultati sono rispetto alla media dei titoli della stessa data.",
      "Universo = titoli attuali del catalogo: i titoli usciti dal mercato mancano (survivorship bias), quindi i risultati tendono a essere ottimistici.",
      "Prezzi corretti per dividendi e split dal fornitore dati. Incertezza: bootstrap a blocchi di date; test multipli: correzione di Holm sulle regole.",
      "Le regole non sono state scelte guardando questi dati: 'recente' (ultimo 40% delle date) serve come verifica di stabilita'.",
    ],
  };
}
