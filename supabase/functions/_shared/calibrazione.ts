// =========================================================================
// CALIBRAZIONE delle probabilita': regressione logistica  P(esito) = sigma(a + b * logit(p dichiarata)).
// Calibrazione perfetta: a = 0 (nessuna sovra/sottostima sistematica), b = 1 (ne' troppo sicuri ne' troppo prudenti).
// b < 1: le probabilita' dichiarate sono troppo estreme (troppo sicure); b > 1: troppo timide.
// La ricalibrazione e' attivata SOLO se, provata su dati piu' recenti di quelli usati per stimarla,
// migliora il punteggio di Brier. Funzioni pure.
// =========================================================================
export interface Calibrazione { a: number; b: number; n: number }

const clip = (p: number) => Math.min(0.999, Math.max(0.001, p));
const logit = (p: number) => Math.log(clip(p) / (1 - clip(p)));
const sig = (x: number) => 1 / (1 + Math.exp(-x));

export function fitCalibrazione(p: ArrayLike<number>, y: ArrayLike<number>, lambda = 2): Calibrazione | null {
  const n = p.length;
  if (n < 30) return null;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = logit(p[i]);
  let a = 0, b = 1;
  for (let it = 0; it < 60; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < n; i++) {
      const mu = sig(a + b * x[i]), w = mu * (1 - mu), r = y[i] - mu;
      g0 += r; g1 += r * x[i]; h00 += w; h01 += w * x[i]; h11 += w * x[i] * x[i];
    }
    // piccolo vincolo verso (a = 0, b = 1) per stabilita' quando i dati sono pochi o quasi uguali
    g0 -= lambda * a; g1 -= lambda * (b - 1); h00 += lambda; h11 += lambda;
    const det = h00 * h11 - h01 * h01;
    if (!(Math.abs(det) > 1e-12)) return null;
    const da = (h11 * g0 - h01 * g1) / det, db = (-h01 * g0 + h00 * g1) / det;
    a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  if (!isFinite(a) || !isFinite(b)) return null;
  return { a, b, n };
}

export function applicaCalibrazione(p: number, c: { a: number; b: number }): number {
  return sig(c.a + c.b * logit(p));
}

export const brier = (p: ArrayLike<number>, y: ArrayLike<number>) => {
  let s = 0; for (let i = 0; i < p.length; i++) s += (p[i] - y[i]) ** 2;
  return p.length ? s / p.length : NaN;
};

export interface PuntoEsito { p: number; y: number; data: string }
export interface RisultatoRicalibrazione {
  attiva: boolean; a: number; b: number; n: number; giorni: number;
  brierPrima: number | null; brierDopoFuoriCampione: number | null; nota: string;
}

// Stima su dati piu' vecchi (70%), verifica su dati piu' recenti (30%): si attiva solo se migliora fuori campione.
export function ricalibrazione(punti: PuntoEsito[], opz: { minCasi?: number; minGiorni?: number; margine?: number } = {}): RisultatoRicalibrazione {
  const minCasi = opz.minCasi ?? 300, minGiorni = opz.minGiorni ?? 30, margine = opz.margine ?? 0.0003;
  const date = [...new Set(punti.map((x) => x.data))].sort();
  const base = { attiva: false, a: 0, b: 1, n: punti.length, giorni: date.length, brierPrima: null as number | null, brierDopoFuoriCampione: null as number | null };
  if (punti.length < minCasi || date.length < minGiorni) return { ...base, nota: "campione insufficiente (servono almeno " + minCasi + " esiti su " + minGiorni + " date diverse)" };
  const taglio = date[Math.floor(date.length * 0.7)];
  const train = punti.filter((x) => x.data < taglio), test = punti.filter((x) => x.data >= taglio);
  if (train.length < minCasi * 0.5 || test.length < 50) return { ...base, nota: "campione di verifica troppo piccolo" };
  const cal = fitCalibrazione(train.map((x) => x.p), train.map((x) => x.y));
  if (!cal) return { ...base, nota: "stima non riuscita" };
  const prima = brier(test.map((x) => x.p), test.map((x) => x.y));
  const dopo = brier(test.map((x) => applicaCalibrazione(x.p, cal)), test.map((x) => x.y));
  const attiva = dopo < prima - margine;
  // se attiva, la correzione finale e' stimata su tutti i dati
  const finale = attiva ? fitCalibrazione(punti.map((x) => x.p), punti.map((x) => x.y)) || cal : cal;
  return { attiva, a: finale.a, b: finale.b, n: punti.length, giorni: date.length, brierPrima: prima, brierDopoFuoriCampione: dopo, nota: attiva ? "migliora il Brier su dati piu' recenti" : "non migliora fuori campione: non applicata" };
}
