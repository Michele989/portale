// =========================================================================
// FONDAMENTALI (SEC EDGAR) + fattori Fama-French + contesto macro FRED: funzioni pure per il test.
// Domanda: i titoli con bilanci migliori (redditivita', crescita, solidita') rendono di piu' nei mesi successivi?
// Regola anti-trucco: un bilancio conta solo DAL GIORNO DOPO la data di pubblicazione ("filed"), con i valori
// com'erano stati pubblicati allora (nessuna correzione successiva).
// =========================================================================
import { holm } from "./validazione.ts";
import { mulberry32, seme } from "./previsioni.ts";

export interface Bilancio { fine: string; pubblicato: string; ricavi: number | null; utile: number | null; patrimonio: number | null; attivo: number | null; margLordo: number | null }
export interface Indicatori { fine: string; pubblicato: string; [k: string]: number | string | null }

const TAG = {
  ricavi: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  utile: ["NetIncomeLoss", "ProfitLoss"],
  patrimonio: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  attivo: ["Assets"],
  lordo: ["GrossProfit"],
};
const giorni = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

// valori ANNUALI (10-K) di un tag: per ogni data di chiusura si tiene la PRIMA pubblicazione
function annuali(facts: any, tags: string[], flusso: boolean): Map<string, { v: number; filed: string }> {
  const out = new Map<string, { v: number; filed: string }>();
  for (const t of tags) {
    const u = facts?.["us-gaap"]?.[t]?.units?.USD;
    if (!Array.isArray(u)) continue;
    for (const r of u) {
      if (r.form !== "10-K" || typeof r.val !== "number" || !r.end || !r.filed) continue;
      if (flusso) { if (!r.start) continue; const d = giorni(r.start, r.end); if (d < 340 || d > 390) continue; }
      const a = out.get(r.end);
      if (!a || r.filed < a.filed) out.set(r.end, { v: r.val, filed: r.filed });
    }
    if (out.size) break; // si usa il primo tag che ha dati
  }
  return out;
}

export function estraiBilanci(companyFacts: any): Bilancio[] {
  const f = companyFacts && companyFacts.facts; if (!f) return [];
  const ric = annuali(f, TAG.ricavi, true), ut = annuali(f, TAG.utile, true), pa = annuali(f, TAG.patrimonio, false), at = annuali(f, TAG.attivo, false), lo = annuali(f, TAG.lordo, true);
  const res: Bilancio[] = [];
  for (const [fine, u] of ut) {
    const r = ric.get(fine), p = pa.get(fine), a = at.get(fine), l = lo.get(fine);
    const pubbl = [u.filed, r && r.filed, p && p.filed, a && a.filed].filter(Boolean).sort().pop() as string;
    res.push({ fine, pubblicato: pubbl, ricavi: r ? r.v : null, utile: u.v, patrimonio: p ? p.v : null, attivo: a ? a.v : null, margLordo: l && r && r.v > 0 ? l.v / r.v : null });
  }
  return res.sort((x, y) => x.fine.localeCompare(y.fine));
}

export const NOMI_INDICATORI: Record<string, string> = {
  roe: "Redditivita' sul capitale (utile / patrimonio)", roa: "Redditivita' sugli attivi (utile / attivo)", margine: "Margine netto (utile / ricavi)",
  margineLordo: "Margine lordo", crescitaRicavi: "Crescita dei ricavi sull'anno prima", crescitaUtile: "Crescita dell'utile sull'anno prima", solidita: "Solidita' (poco debito)",
};

export function indicatori(bil: Bilancio[]): Indicatori[] {
  const out: Indicatori[] = [];
  for (let i = 0; i < bil.length; i++) {
    const b = bil[i];
    const prec = bil.slice(0, i).reverse().find((x) => Math.abs(giorni(x.fine, b.fine) - 365) <= 40);
    const o: Indicatori = { fine: b.fine, pubblicato: b.pubblicato, roe: null, roa: null, margine: null, margineLordo: b.margLordo, crescitaRicavi: null, crescitaUtile: null, solidita: null };
    if (b.utile !== null && b.patrimonio && b.patrimonio > 0) o.roe = b.utile / b.patrimonio;
    if (b.utile !== null && b.attivo && b.attivo > 0) o.roa = b.utile / b.attivo;
    if (b.utile !== null && b.ricavi && b.ricavi > 0) o.margine = b.utile / b.ricavi;
    if (b.patrimonio !== null && b.attivo && b.attivo > 0) o.solidita = b.patrimonio / b.attivo; // piu' alto = meno debito
    if (prec) {
      if (b.ricavi && prec.ricavi && prec.ricavi > 0) o.crescitaRicavi = b.ricavi / prec.ricavi - 1;
      if (b.utile !== null && prec.utile !== null && Math.abs(prec.utile) > 0) o.crescitaUtile = (b.utile - prec.utile) / Math.abs(prec.utile);
    }
    out.push(o);
  }
  return out;
}

// ultimo bilancio gia' pubblicato PRIMA della data e non piu' vecchio di 15 mesi
export function valoreA(ind: Indicatori[], data: string, chiave: string): number | null {
  for (let i = ind.length - 1; i >= 0; i--) {
    if (ind[i].pubblicato < data) { if (giorni(ind[i].fine, data) > 456) return null; const v = ind[i][chiave]; return typeof v === "number" && isFinite(v) ? v : null; }
  }
  return null;
}

export function fineMesi(da: string, a: string): string[] {
  const out: string[] = []; let y = +da.slice(0, 4), m = +da.slice(5, 7);
  for (;;) { const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); if (d > a) break; if (d >= da) out.push(d); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export function prezzoA(cron: { d: string; c: number }[], data: string): number | null {
  let lo = 0, hi = cron.length - 1, r = -1;
  while (lo <= hi) { const md = (lo + hi) >> 1; if (cron[md].d <= data) { r = md; lo = md + 1; } else hi = md - 1; }
  return r >= 0 && giorni(cron[r].d, data) <= 7 ? cron[r].c : null;
}

// ---------- spread mensile alto-basso (quintili) ----------
export function spreadMensili(titoli: { ticker: string; cron: { d: string; c: number }[]; ind: Indicatori[] }[], chiave: string, minTitoli = 40) {
  let da = "9999", a = "0000";
  for (const t of titoli) for (const i of t.ind) { if (i.pubblicato < da) da = i.pubblicato as string; }
  for (const t of titoli) { const u = t.cron[t.cron.length - 1]; if (u && u.d > a) a = u.d; }
  const mesi = fineMesi(da, a), out: { mese: string; spread: number; sopra: number; n: number }[] = [];
  for (let k = 0; k + 1 < mesi.length; k++) {
    const m0 = mesi[k], m1 = mesi[k + 1], righe: { v: number; r: number }[] = [];
    for (const t of titoli) {
      const v = valoreA(t.ind, m0, chiave); if (v === null) continue;
      const p0 = prezzoA(t.cron, m0), p1 = prezzoA(t.cron, m1); if (!p0 || !p1) continue;
      righe.push({ v, r: (p1 / p0 - 1) * 100 });
    }
    if (righe.length < minTitoli) continue;
    righe.sort((x, y) => x.v - y.v);
    const q = Math.floor(righe.length / 5), basso = righe.slice(0, q), alto = righe.slice(-q);
    const media = (x: { r: number }[]) => x.reduce((s, y) => s + y.r, 0) / x.length;
    out.push({ mese: m0.slice(0, 7), spread: media(alto) - media(basso), sopra: media(alto) - media(righe), n: righe.length });
  }
  return out;
}

// ---------- statistica ----------
export function bootstrapMedia(x: number[], blocco: number, B: number, rnd: () => number) {
  const n = x.length; if (n < 24) return null;
  const L = Math.max(1, Math.min(blocco, n)), nb = Math.ceil(n / L), medie: number[] = [];
  for (let b = 0; b < B; b++) { let s = 0, c = 0; for (let k = 0; k < nb; k++) { const st = Math.floor(rnd() * n); for (let j = 0; j < L && c < n; j++, c++) s += x[(st + j) % n]; } medie.push(s / n); }
  medie.sort((a, b) => a - b);
  const m = x.reduce((s, y) => s + y, 0) / n, sd = Math.sqrt(medie.reduce((s, y) => s + (y - m) ** 2, 0) / B) || 1e-12;
  const sotto = medie.filter((y) => y - m <= -m).length; // p unilaterale: media centrata sotto zero
  const p = (medie.filter((y) => y - m >= m).length + 1) / (B + 1); void sotto;
  return { media: m, ci95: [medie[Math.floor(0.025 * B)], medie[Math.floor(0.975 * B)]] as [number, number], pUnilat: p, t: m / sd, n };
}

function risolvi(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function inversa(A: number[][]): number[][] | null {
  const n = A.length, cols: number[][] = [];
  for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; const s = risolvi(A, e); if (!s) return null; cols.push(s); }
  return A.map((_, i) => cols.map((c) => c[i]));
}
// regressione spread ~ fattori: intercetta (alfa) con errori standard di Newey-West (lag 3)
export function alfaFattori(y: number[], X: number[][], lag = 3) {
  const n = y.length, k = X[0].length + 1; if (n < 36) return null;
  const Z = X.map((r) => [1, ...r]);
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => Z.reduce((s, r) => s + r[i] * r[j], 0)));
  const Xty = Array.from({ length: k }, (_, i) => Z.reduce((s, r, t) => s + r[i] * y[t], 0));
  const beta = risolvi(XtX, Xty), inv = inversa(XtX); if (!beta || !inv) return null;
  const e = y.map((v, t) => v - Z[t].reduce((s, z, i) => s + z * beta[i], 0));
  const S = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let l = 0; l <= lag; l++) {
    const w = l === 0 ? 1 : 1 - l / (lag + 1);
    for (let t = l; t < n; t++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const v = w * e[t] * e[t - l] * Z[t][i] * Z[t - l][j]; S[i][j] += v; if (l > 0) S[j][i] += v;
    }
  }
  const V = inv.map((r, i) => r.map((_, j) => { let s = 0; for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += inv[i][a] * S[a][b] * inv[b][j]; return s; }));
  const se = Math.sqrt(Math.max(V[0][0], 1e-18));
  const ss = y.reduce((s, v) => s + (v - y.reduce((a, b) => a + b, 0) / n) ** 2, 0), sse = e.reduce((s, v) => s + v * v, 0);
  return { alfa: beta[0], t: beta[0] / se, betaFattori: beta.slice(1), r2: ss > 0 ? 1 - sse / ss : 0, n };
}

// ---------- lettura dei file esterni ----------
export function leggiFamaFrench(testo: string): Map<string, number[]> { // righe "YYYYMM, v1, v2, ..." (mensili)
  const m = new Map<string, number[]>();
  for (const riga of testo.split(/\r?\n/)) {
    const c = riga.split(",").map((s) => s.trim());
    if (/^\d{6}$/.test(c[0]) && c.length > 2) { const v = c.slice(1).map(Number); if (v.every((x) => isFinite(x) && x > -99)) m.set(c[0].slice(0, 4) + "-" + c[0].slice(4), v); }
  }
  return m;
}
export function leggiFred(csv: string): { d: string; v: number }[] {
  const out: { d: string; v: number }[] = [];
  for (const riga of csv.split(/\r?\n/).slice(1)) { const [d, v] = riga.split(","); const x = Number(v); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v !== "." && isFinite(x)) out.push({ d, v: x }); }
  return out;
}
export function ultimoPerMese(serie: { d: string; v: number }[]): Map<string, number> {
  const m = new Map<string, number>(); for (const s of serie) m.set(s.d.slice(0, 7), s.v); return m;
}

// ---------- test completo ----------
export function testFondamentali(titoli: { ticker: string; cron: { d: string; c: number }[]; ind: Indicatori[] }[], opz: { ff?: Map<string, number[]>; mom?: Map<string, number[]>; curva?: Map<string, number>; vix?: Map<string, number>; B?: number; seed?: string } = {}) {
  const B = opz.B ?? 2000, rnd = mulberry32(seme(opz.seed ?? "fond1"));
  const righe: any[] = [];
  for (const chiave of Object.keys(NOMI_INDICATORI)) {
    const s = spreadMensili(titoli, chiave); if (s.length < 36) { righe.push({ indicatore: chiave, mesi: s.length, nota: "pochi mesi" }); continue; }
    const x = s.map((r) => r.spread);
    const tot = bootstrapMedia(x, 3, B, rnd), taglio = Math.floor(x.length * 0.6), rec = bootstrapMedia(x.slice(taglio), 3, Math.floor(B / 2), rnd);
    let fattori = null;
    if (opz.ff) {
      const Y: number[] = [], X: number[][] = [];
      s.forEach((r) => { const f = opz.ff!.get(r.mese), mo = opz.mom && opz.mom.get(r.mese); if (f && f.length >= 5 && (!opz.mom || mo)) { Y.push(r.spread); X.push([...f.slice(0, 5), ...(mo ? [mo[0]] : [])]); } });
      fattori = alfaFattori(Y, X);
    }
    const reg = (mappa: Map<string, number> | undefined, dividi: (v: number, med: number) => boolean) => {
      if (!mappa) return null; const v = s.map((r) => mappa.get(r.mese)).filter((z): z is number => z !== undefined); if (v.length < 24) return null;
      const med = [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)], a: number[] = [], b: number[] = [];
      s.forEach((r) => { const z = mappa.get(r.mese); if (z === undefined) return; (dividi(z, med) ? a : b).push(r.spread); });
      const mm = (q: number[]) => (q.length ? q.reduce((u, w) => u + w, 0) / q.length : null);
      return { mesi_a: a.length, media_a: mm(a), mesi_b: b.length, media_b: mm(b) };
    };
    righe.push({ indicatore: chiave, nome: NOMI_INDICATORI[chiave], mesi: s.length, titoliMedi: Math.round(s.reduce((a, r) => a + r.n, 0) / s.length), dal: s[0].mese, al: s[s.length - 1].mese, ...tot, recente: rec, fattori, curva_invertita_vs_normale: reg(opz.curva, (v) => v < 0), vix_alto_vs_basso: reg(opz.vix, (v, med) => v > med) });
  }
  const ph = holm(righe.map((r) => (r.pUnilat === undefined ? null : r.pUnilat)));
  righe.forEach((r, i) => { r.pHolm = ph[i]; });
  const dim = righe.filter((r) => r.pHolm !== null && r.pHolm < 0.05 && r.ci95 && r.ci95[0] > 0 && r.recente && r.recente.ci95 && r.recente.ci95[0] > 0 && (!r.fattori || r.fattori.t > 2));
  const conclusione = dim.length
    ? "Vantaggio dimostrato (dopo test multipli, periodo recente e fattori noti) per: " + dim.map((r) => r.indicatore).join(", ") + ". Va verificato nel tempo con le previsioni reali."
    : "Nessun indicatore di bilancio batte in modo dimostrabile gli altri titoli (dopo correzione per test multipli, periodo recente e fattori Fama-French).";
  return { versione: "f1.0", generato: new Date().toISOString(), indicatori: righe, conclusione, note: [
    "Il bilancio conta solo dal giorno dopo la pubblicazione, con i valori originali (nessuna correzione successiva).",
    "Solo societa' USA con bilanci su EDGAR; ETF ed estere escluse. Universo = titoli attuali (survivorship bias: risultati ottimistici).",
    "Spread = rendimento del mese successivo del quinto migliore meno il quinto peggiore (punti %). L'alfa e' lo spread che resta dopo i fattori Fama-French a 5 + momentum.",
    "Il valore (prezzo/utili) non e' testato: i prezzi salvati sono corretti per gli split e i bilanci no.",
  ] };
}
