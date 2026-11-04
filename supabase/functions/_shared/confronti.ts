// Confronti e controlli di contesto (tutto gratuito, solo calcoli su dati già scaricati):
// - rendimenti "senza fare nulla" di un indice (SPY) per orizzonte
// - volatilità del mercato
// - liquidità del titolo
// - effetto del cambio euro/dollaro
import type { Barra } from "./analisi.ts";

export type Orizz = "breve" | "medio" | "lungo";
export const GIORNI_ORIZZONTE: Record<Orizz, number> = { breve: 21, medio: 63, lungo: 252 };

function quantile(ord: number[], q: number): number {
  if (!ord.length) return NaN;
  const pos = (ord.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return ord[lo] + (ord[hi] - ord[lo]) * (pos - lo);
}

export interface RendTenere { pPositivi: number | null; mediana: number | null; p10: number | null; p90: number | null; n: number }

// Rendimento di "comprare e tenere" per ogni periodo possibile della stessa durata. Barre: dalla più recente.
export function rendimentiTenere(barre: Barra[]): Record<Orizz, RendTenere> {
  const c = barre.map((x) => x.c).reverse();
  const out = {} as Record<Orizz, RendTenere>;
  for (const k of Object.keys(GIORNI_ORIZZONTE) as Orizz[]) {
    const h = GIORNI_ORIZZONTE[k], r: number[] = [];
    for (let i = 0; i + h < c.length; i++) if (c[i] > 0) r.push((c[i + h] / c[i] - 1) * 100);
    if (r.length < 30) { out[k] = { pPositivi: null, mediana: null, p10: null, p90: null, n: r.length }; continue; }
    const o = r.slice().sort((a, b) => a - b);
    out[k] = { pPositivi: (r.filter((x) => x > 0).length / r.length) * 100, mediana: quantile(o, 0.5), p10: quantile(o, 0.1), p90: quantile(o, 0.9), n: r.length };
  }
  return out;
}

// Volatilità realizzata a 20 giorni (annualizzata, %) e sua posizione rispetto all'ultimo anno. Barre: dalla più recente.
export function volatilitaMercato(barre: Barra[]): { valore: number; percentile: number; alta: boolean } | null {
  const c = barre.map((x) => x.c).reverse();
  if (c.length < 300) return null;
  const rr = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : 0)).slice(1);
  const vol = (fine: number) => { const f = rr.slice(fine - 20, fine); const m = f.reduce((a, b) => a + b, 0) / f.length; return Math.sqrt(f.reduce((a, b) => a + (b - m) ** 2, 0) / (f.length - 1)) * Math.sqrt(252) * 100; };
  const ora = vol(rr.length);
  const storia: number[] = [];
  for (let e = rr.length - 252; e <= rr.length; e += 5) if (e >= 20) storia.push(vol(e));
  const percentile = (storia.filter((x) => x <= ora).length / storia.length) * 100;
  return { valore: ora, percentile, alta: ora >= 25 && percentile >= 80 };
}

// Liquidità: controvalore medio scambiato (prezzo × volume) nelle ultime 60 sedute. Barre: dalla più recente.
// Se il volume manca (indici, alcuni ETF) non si giudica: bassa = false e valore = null.
export function liquidita(barre: Barra[], soglia = 1_000_000): { valore: number | null; bassa: boolean } {
  const u = barre.slice(0, 60).filter((b) => b.v > 0);
  if (u.length < 30) return { valore: null, bassa: false };
  const v = u.map((b) => b.c * b.v).sort((a, b) => a - b);
  const mediana = quantile(v, 0.5);
  return { valore: mediana, bassa: mediana < soglia };
}

export interface EffettoCambio {
  coppia: string; // es. "EUR/USD"
  variazione12m: number | null; // % di variazione del dollaro rispetto all'euro nell'ultimo anno (positivo = dollaro più forte)
  orizzonti: Record<Orizz, { p10: number; mediana: number; p90: number } | null>; // effetto sul rendimento in euro, in %
}

// Per chi compra in euro un titolo in dollari: se l'euro si rafforza (EUR/USD sale) il guadagno in euro si riduce.
// Effetto = (cambio all'acquisto / cambio alla vendita - 1). Barre del cambio: dalla più recente.
export function effettoCambio(fx: Barra[]): EffettoCambio | null {
  const c = fx.map((x) => x.c).reverse();
  if (c.length < 300) return null;
  const orizzonti = {} as EffettoCambio["orizzonti"];
  for (const k of Object.keys(GIORNI_ORIZZONTE) as Orizz[]) {
    const h = GIORNI_ORIZZONTE[k], e: number[] = [];
    for (let i = 0; i + h < c.length; i++) e.push((c[i] / c[i + h] - 1) * 100);
    if (e.length < 30) { orizzonti[k] = null; continue; }
    const o = e.slice().sort((a, b) => a - b);
    orizzonti[k] = { p10: quantile(o, 0.1), mediana: quantile(o, 0.5), p90: quantile(o, 0.9) };
  }
  const ult = c.length - 1;
  const dollaro = (c[ult - 252] / c[ult] - 1) * 100; // dollaro più forte se EUR/USD scende
  return { coppia: "EUR/USD", variazione12m: dollaro, orizzonti };
}

// Chiusure del titolo convertite in EURO, allineate alla serie CRONOLOGICA `cron` (dal più vecchio al più recente).
// fx = barre EUR/USD dalla più recente (dollari per 1 euro). Per i giorni senza cambio si usa l'ultimo noto prima
// di quella data (o il primo disponibile). Restituisce null se il cambio non copre bene l'ultimo periodo.
export function chiusureInEuro(cron: Barra[], fx: Barra[] | null | undefined): number[] | null {
  if (!fx || fx.length < 300 || !cron.length) return null;
  const f = fx.slice().reverse().filter((b) => b.c > 0); // cronologico
  if (f.length < 300) return null;
  const ultimoCron = cron[cron.length - 1].d, ultimoFx = f[f.length - 1].d;
  const giorniScarto = (new Date(ultimoCron + "T00:00:00Z").getTime() - new Date(ultimoFx + "T00:00:00Z").getTime()) / 86400000;
  if (giorniScarto > 10) return null; // cambio non aggiornato
  const out: number[] = [];
  let k = 0;
  for (const b of cron) {
    while (k + 1 < f.length && f[k + 1].d <= b.d) k++;
    out.push(b.c / f[k].c);
  }
  return out;
}
