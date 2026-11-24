// =========================================================================
// GARCH(1,1) con "variance targeting": sigma2_t = omega + alpha*e_{t-1}^2 + beta*sigma2_{t-1},
// omega = V*(1-alpha-beta), dove V = varianza di lungo periodo del campione.
// Stima a massima verosimiglianza (gaussiana, quasi-ML) con ricerca su griglia + affinamento locale:
// niente librerie, risultati riproducibili. Serve a stimare QUANTO puo' oscillare il prezzo,
// non la direzione. Funzioni pure.
// =========================================================================
export interface ParamGarch { omega: number; alpha: number; beta: number; mu: number; varLungo: number; sigma2Prossima: number; persistenza: number }

function neglogLik(e: number[], v0: number, alpha: number, beta: number): number {
  const omega = v0 * (1 - alpha - beta);
  let s2 = v0, ll = 0;
  for (let t = 0; t < e.length; t++) {
    if (!(s2 > 1e-14)) return Infinity;
    ll += Math.log(s2) + (e[t] * e[t]) / s2;
    s2 = omega + alpha * e[t] * e[t] + beta * s2;
  }
  return ll;
}

export function stimaGarch(rendimenti: number[]): ParamGarch | null {
  const n = rendimenti.length;
  if (n < 250) return null;
  let mu = 0; for (const r of rendimenti) mu += r; mu /= n;
  const e = rendimenti.map((r) => r - mu);
  let v0 = 0; for (const x of e) v0 += x * x; v0 /= n;
  if (!(v0 > 1e-12) || !isFinite(v0)) return null;
  let best = { a: 0.08, b: 0.9, f: Infinity };
  for (const a of [0.02, 0.05, 0.08, 0.12, 0.18, 0.25]) for (const b of [0.7, 0.8, 0.88, 0.92, 0.95, 0.97]) {
    if (a + b >= 0.999) continue;
    const f = neglogLik(e, v0, a, b);
    if (f < best.f) best = { a, b, f };
  }
  let pa = 0.02, pb = 0.04;
  for (let it = 0; it < 40; it++) {
    let mosso = false;
    for (const [da, db] of [[pa, 0], [-pa, 0], [0, pb], [0, -pb], [pa, pb], [-pa, -pb], [pa, -pb], [-pa, pb]]) {
      const a = best.a + da, b = best.b + db;
      if (a < 0.001 || b < 0.3 || a + b >= 0.999 || b >= 0.999) continue;
      const f = neglogLik(e, v0, a, b);
      if (f < best.f - 1e-9) { best = { a, b, f }; mosso = true; }
    }
    if (!mosso) { pa /= 2; pb /= 2; if (pa < 1e-4) break; }
  }
  if (!isFinite(best.f)) return null;
  const omega = v0 * (1 - best.a - best.b);
  // varianza condizionata per il giorno successivo all'ultimo dato
  let s2 = v0;
  for (let t = 0; t < n; t++) s2 = omega + best.a * e[t] * e[t] + best.b * s2;
  return { omega, alpha: best.a, beta: best.b, mu, varLungo: v0, sigma2Prossima: s2, persistenza: best.a + best.b };
}

// varianza media giornaliera attesa nei prossimi h giorni
export function varianzaAttesaMedia(p: ParamGarch, h: number): number {
  const pers = p.persistenza;
  let somma = 0;
  for (let k = 1; k <= h; k++) somma += p.varLungo + Math.pow(pers, k - 1) * (p.sigma2Prossima - p.varLungo);
  return somma / h;
}

// Simulazione con innovazioni t di Student (nu gradi di liberta', varianza unitaria).
export function simulaGarch(p: ParamGarch, h: number, sim: number, rnd: () => number, nu = 6): number[] {
  const out: number[] = [];
  const scala = Math.sqrt((nu - 2) / nu);
  let riserva: number | null = null;
  const normale = (): number => {
    if (riserva !== null) { const r = riserva; riserva = null; return r; }
    const u1 = Math.max(rnd(), 1e-12), u2 = rnd();
    const raggio = Math.sqrt(-2 * Math.log(u1));
    riserva = raggio * Math.sin(2 * Math.PI * u2);
    return raggio * Math.cos(2 * Math.PI * u2);
  };
  for (let s = 0; s < sim; s++) {
    let s2 = p.sigma2Prossima, valore = 1;
    for (let k = 0; k < h; k++) {
      let chi = 0; for (let j = 0; j < nu; j++) { const z = normale(); chi += z * z; }
      const z = (normale() / Math.sqrt(chi / nu)) * scala;
      const e = Math.sqrt(s2) * z;
      valore *= 1 + p.mu + e;
      if (valore < 0) valore = 0;
      s2 = p.omega + p.alpha * e * e + p.beta * s2;
    }
    out.push((valore - 1) * 100);
  }
  return out;
}

export function rendimentiGiornalieri(chiusure: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < chiusure.length; i++) r.push(chiusure[i] / chiusure[i - 1] - 1);
  return r;
}
